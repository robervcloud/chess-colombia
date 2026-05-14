/**
 * Servicio de tácticas (puzzles).
 *
 * - getNextPuzzle: elige uno cuyo rating esté ±band del jugador,
 *   evitando los recientes. Devuelve el puzzle SIN la solution
 *   completa al cliente: sólo FEN, sideToMove y la primera jugada
 *   del oponente (que el cliente aplica para mostrar la posición).
 *   El resto de la solución NO se manda hasta finalizar el intento.
 *
 *   (Anti-trampa rudimentaria. Para validar movimiento a movimiento
 *    en vivo, devolvemos la solución completa en este MVP — los
 *    puzzles tácticos son contenido por usuario, no competitivo;
 *    inflar tu propio rating no afecta a otros.)
 *
 * - recordAttempt: aplica un Elo simplificado (k-factor dinámico),
 *   actualiza streak, persiste el intento y devuelve el delta.
 *
 * Rating Elo simplificado (no Glicko completo para mantener bajo costo):
 *   expected = 1 / (1 + 10^((puzzleRating - userRating) / 400))
 *   delta = K * (actual - expected)
 *   K base = 32. Ajustado a la baja si hubo hints o se demoró mucho:
 *     - cada hint usado: K -= 8 (mín 8)
 *     - tiempo > 60s: K -= 8 adicional
 *   Si fail: K se aplica con actual = 0 (delta negativo).
 *
 * RD (rating deviation): baja con cada intento. Sirve para mostrar
 *   confidence. No usado en cálculo de delta en este MVP.
 */

const supabase = require('../config/supabase');

const RATING_BAND = 250;          // ±250 del usuario para elegir puzzle
const RECENT_KEEP = 20;           // últimos N puzzles a evitar
const RATING_FLOOR = 100;
const RATING_CEIL = 3000;

async function getOrCreateStats(userId) {
  const { data, error } = await supabase
    .from('user_tactics_stats')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[tactics.getOrCreateStats]', error);
    throw { status: 500, message: 'No se pudo cargar stats' };
  }
  if (data) return data;

  // Crear fila inicial
  const init = {
    user_id: userId,
    rating: 800,
    rd: 350,
    solved: 0,
    attempted: 0,
    current_streak: 0,
    best_streak: 0,
    total_time_ms: 0,
    by_theme: {},
    recent_ids: [],
  };
  const { data: inserted, error: insErr } = await supabase
    .from('user_tactics_stats')
    .insert(init)
    .select('*')
    .single();
  if (insErr) {
    console.error('[tactics.getOrCreateStats.insert]', insErr);
    throw { status: 500, message: 'No se pudo crear stats' };
  }
  return inserted;
}

/** Selecciona un puzzle adecuado y devuelve el shape para el cliente. */
async function getNextPuzzle(userId) {
  const stats = await getOrCreateStats(userId);
  const lo = Math.max(RATING_FLOOR, stats.rating - RATING_BAND);
  const hi = Math.min(RATING_CEIL, stats.rating + RATING_BAND);

  // Intentamos primero excluir los recientes; si no hay, ampliamos.
  let { data: rows, error } = await supabase
    .from('puzzles')
    .select('id, fen, moves_uci, rating, themes')
    .gte('rating', lo)
    .lte('rating', hi)
    .not('id', 'in', `(${(stats.recent_ids || []).map((s) => `"${s}"`).join(',') || '"_"'})`)
    .limit(50);

  if (error) {
    console.error('[tactics.getNextPuzzle]', error);
    throw { status: 500, message: 'No se pudo seleccionar puzzle' };
  }

  if (!rows || rows.length === 0) {
    // Ampliar banda si no hay candidatos sin repetir
    const r = await supabase
      .from('puzzles')
      .select('id, fen, moves_uci, rating, themes')
      .gte('rating', Math.max(RATING_FLOOR, stats.rating - 500))
      .lte('rating', Math.min(RATING_CEIL, stats.rating + 500))
      .limit(50);
    if (r.error || !r.data || r.data.length === 0) {
      // Última opción: cualquier puzzle
      const r2 = await supabase.from('puzzles').select('id, fen, moves_uci, rating, themes').limit(50);
      rows = r2.data || [];
    } else {
      rows = r.data;
    }
  }

  if (!rows || rows.length === 0) {
    throw { status: 404, message: 'No hay puzzles disponibles. Importa o sembra primero.' };
  }

  const pick = rows[Math.floor(Math.random() * rows.length)];

  // Devolvemos al cliente lo necesario. El primer move uci es del oponente.
  const moves = pick.moves_uci.split(/\s+/).filter(Boolean);
  return {
    id: pick.id,
    fen: pick.fen,
    rating: pick.rating,
    themes: pick.themes || [],
    setupMove: moves[0] || null,   // jugada del oponente para "armar" la posición
    solution: moves.slice(1),      // jugadas que el usuario debe encontrar
                                   // (con respuestas del rival intercaladas)
    userRating: stats.rating,
  };
}

/**
 * Aplica resultado del intento y actualiza rating + stats + recent_ids + by_theme.
 * Devuelve los nuevos valores y el delta aplicado.
 */
async function recordAttempt(userId, { puzzleId, solved, hintsUsed = 0, timeMs = 0 }) {
  // Plausibilidad mínima
  if (typeof timeMs !== 'number' || timeMs < 0) timeMs = 0;
  if (timeMs > 30 * 60 * 1000) timeMs = 30 * 60 * 1000; // tope 30 min
  hintsUsed = Math.max(0, Math.min(3, parseInt(hintsUsed, 10) || 0));

  // 1) Obtener puzzle (rating + themes)
  const { data: puzzle, error: pErr } = await supabase
    .from('puzzles')
    .select('id, rating, themes')
    .eq('id', puzzleId)
    .single();
  if (pErr || !puzzle) throw { status: 404, message: 'Puzzle no encontrado' };

  // 2) Obtener stats del usuario
  const stats = await getOrCreateStats(userId);

  // 3) Calcular delta con K dinámico
  const expected = 1 / (1 + Math.pow(10, (puzzle.rating - stats.rating) / 400));
  let K = 32;
  if (hintsUsed >= 1) K -= 8;
  if (hintsUsed >= 2) K -= 8;
  if (hintsUsed >= 3) K -= 8;
  if (timeMs > 60_000) K -= 8;
  K = Math.max(8, K);
  const actual = solved ? 1 : 0;
  // Si falló, mínimo -K*expected; si acertó con hints, ganancia reducida.
  const delta = Math.round(K * (actual - expected));

  const newRating = Math.max(100, Math.min(3000, stats.rating + delta));
  const newSolved = stats.solved + (solved ? 1 : 0);
  const newAttempted = stats.attempted + 1;
  const newStreak = solved ? stats.current_streak + 1 : 0;
  const newBest = Math.max(stats.best_streak, newStreak);
  const newRd = Math.max(60, stats.rd - 5); // baja la incertidumbre
  const newRecent = [puzzleId, ...(stats.recent_ids || []).filter((x) => x !== puzzleId)].slice(0, RECENT_KEEP);

  // by_theme: incrementar contadores por tema (jsonb)
  const byTheme = { ...(stats.by_theme || {}) };
  for (const t of puzzle.themes || []) {
    const cur = byTheme[t] || { solved: 0, attempted: 0 };
    cur.attempted += 1;
    if (solved) cur.solved += 1;
    byTheme[t] = cur;
  }

  // 4) Persistir stats
  const { error: uErr } = await supabase
    .from('user_tactics_stats')
    .update({
      rating: newRating,
      rd: newRd,
      solved: newSolved,
      attempted: newAttempted,
      current_streak: newStreak,
      best_streak: newBest,
      total_time_ms: stats.total_time_ms + timeMs,
      by_theme: byTheme,
      recent_ids: newRecent,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (uErr) console.warn('[tactics.recordAttempt.update]', uErr.message);

  // 5) Append intento (best-effort)
  supabase.from('puzzle_attempts').insert({
    user_id: userId,
    puzzle_id: puzzleId,
    solved,
    hints_used: hintsUsed,
    time_ms: timeMs,
    rating_delta: delta,
  }).then(({ error }) => {
    if (error) console.warn('[tactics.recordAttempt.insertAttempt]', error.message);
  });

  // 6) Update agregados del puzzle (popularidad, success_rate)
  supabase.rpc('puzzle_update_aggregates', { p_puzzle_id: puzzleId, p_solved: solved })
    .then(({ error }) => {
      if (error) {
        // Si la RPC no existe (no es crítica), ignorar silenciosamente
        if (!String(error.message).includes('does not exist')) {
          console.warn('[tactics.recordAttempt.rpc]', error.message);
        }
      }
    });

  return {
    delta,
    newRating,
    streak: newStreak,
    bestStreak: newBest,
    solved: newSolved,
    attempted: newAttempted,
  };
}

async function getStats(userId) {
  return await getOrCreateStats(userId);
}

module.exports = { getNextPuzzle, recordAttempt, getStats };
