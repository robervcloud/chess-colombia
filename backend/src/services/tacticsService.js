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

const RATING_BAND = 70;          // ±70 del usuario para elegir puzzle
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

  // Crear fila inicial — UPSERT idempotente.
  // Si dos requests llegan a la vez, ninguna falla con duplicate-key:
  // ignoreDuplicates evita conflicto; luego re-leemos el row real.
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
  const { error: upErr } = await supabase
    .from('user_tactics_stats')
    .upsert(init, { onConflict: 'user_id', ignoreDuplicates: true });
  if (upErr) {
    console.error('[tactics.getOrCreateStats.upsert]', upErr);
    throw { status: 500, message: 'No se pudo crear stats' };
  }
  // Re-leer (siempre, porque ignoreDuplicates no devuelve la fila existente)
  const { data: reread, error: rrErr } = await supabase
    .from('user_tactics_stats')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (rrErr || !reread) {
    console.error('[tactics.getOrCreateStats.reread]', rrErr);
    throw { status: 500, message: 'No se pudo leer stats tras upsert' };
  }
  return reread;
}

/** Selecciona un puzzle adecuado y devuelve el shape para el cliente. */
// Offsets de dificultad relativos al rating del usuario.
const DIFFICULTY = {
  easy:    { center: -300, band: 150 },
  normal:  { center: 0,    band: 100 },
  hard:    { center: +300, band: 150 },
  extreme: { center: +600, band: 300 },
};

async function getNextPuzzle(userId, opts = {}) {
  const stats = await getOrCreateStats(userId);

  // Modo repeat: servir un puzzle fallado recientemente (entrenamiento,
  // rating neutro — ver recordAttempt). Prioriza fallos recientes.
  if (opts.mode === 'repeat') {
    const { data: failed } = await supabase
      .from('puzzle_attempts')
      .select('puzzle_id, created_at')
      .eq('user_id', userId)
      .eq('solved', false)
      .order('created_at', { ascending: false })
      .limit(60);
    const ids = [...new Set((failed || []).map((r) => r.puzzle_id))]
      .filter((id) => !(stats.recent_ids || []).includes(id))
      .slice(0, 30);
    if (ids.length) {
      const { data: rp } = await supabase
        .from('puzzles')
        .select('id, fen, moves_uci, rating, themes')
        .in('id', ids)
        .limit(30);
      if (rp && rp.length) {
        const pk = rp[Math.floor(Math.random() * rp.length)];
        const mv = pk.moves_uci.split(/\s+/).filter(Boolean);
        return {
          id: pk.id, fen: pk.fen, rating: pk.rating, themes: pk.themes || [],
          setupMove: mv[0] || null, solution: mv.slice(1),
          userRating: stats.rating, repeat: true,
        };
      }
    }
    // sin fallados pendientes → cae a selección normal
  }

  const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
  const target = stats.rating + diff.center;
  const lo = Math.max(RATING_FLOOR, target - diff.band);
  const hi = Math.min(RATING_CEIL, target + diff.band);

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
      .gte('rating', Math.max(RATING_FLOOR, target - 500))
      .lte('rating', Math.min(RATING_CEIL, target + 500))
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
    repeat: false,
  };
}

/**
 * Aplica resultado del intento y actualiza rating + stats + recent_ids + by_theme.
 * Devuelve los nuevos valores y el delta aplicado.
 */
async function recordAttempt(userId, { puzzleId, solved, hintsUsed = 0, timeMs = 0, hadWrongMove = false, mode } = {}) {
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

  // 3) NUEVA LÓGICA DE SCORING
  //  - Usar pista        → cuenta como FALLO, sin rating/XP.
  //  - Movimiento erróneo → cuenta como FALLO, sin rating/XP (aunque
  //                         después resuelva: puede seguir intentando).
  //  - Modo 'repeat'      → entrenamiento: rating NEUTRO (delta 0), no XP.
  //  Un puzzle sólo es "limpio" (cuenta solved + gana rating) si:
  //  solved === true && hintsUsed === 0 && !hadWrongMove.
  const isRepeat = mode === 'repeat';
  const cleanSolve = solved === true && hintsUsed === 0 && !hadWrongMove;
  // "solvedForStats": resolvió el puzzle (aunque con ayuda) — sirve para
  // streak de constancia y daily, NO para rating.
  const solvedForStats = solved === true;

  let delta = 0;
  const expected = 1 / (1 + Math.pow(10, (puzzle.rating - stats.rating) / 400));
  if (!isRepeat) {
    if (cleanSolve) {
      let K = 32;
      if (timeMs > 60_000) K -= 8;
      K = Math.max(8, K);
      delta = Math.round(K * (1 - expected));
    } else {
      // Fallo (incluye hint/wrong move). Penalización proporcional.
      let K = 32;
      if (timeMs > 60_000) K -= 8;
      K = Math.max(8, K);
      delta = Math.round(K * (0 - expected));
    }
  }
  // isRepeat → delta queda 0 (rating neutro)

  const newRating = Math.max(100, Math.min(3000, stats.rating + delta));
  const newSolved = stats.solved + (solvedForStats ? 1 : 0);
  const newAttempted = stats.attempted + 1;
  // Streak de constancia se rompe ante fallo "real" (no en repeat).
  const streakWin = isRepeat ? stats.current_streak : (cleanSolve ? stats.current_streak + 1 : 0);
  const newStreak = streakWin;
  const newBest = Math.max(stats.best_streak, newStreak);
  const newRd = Math.max(60, stats.rd - (isRepeat ? 0 : 5));
  const newRecent = [puzzleId, ...(stats.recent_ids || []).filter((x) => x !== puzzleId)].slice(0, RECENT_KEEP);

  // by_theme: contadores por tema (jsonb). attempted siempre; solved sólo
  // si lo resolvió (con o sin ayuda, refleja exposición al tema).
  const byTheme = { ...(stats.by_theme || {}) };
  for (const t of puzzle.themes || []) {
    const cur = byTheme[t] || { solved: 0, attempted: 0 };
    cur.attempted += 1;
    if (solvedForStats) cur.solved += 1;
    byTheme[t] = cur;
  }

  // Daily streak + XP. Sólo cuenta el solve LIMPIO (cleanSolve) y nunca
  // en modo repeat.
  const today = new Date().toISOString().slice(0, 10);
  let dailyStreak = stats.daily_streak || 0;
  const countsForDaily = cleanSolve && !isRepeat;
  if (countsForDaily) {
    const last = stats.last_solved_day; // 'YYYY-MM-DD' | null
    if (last === today) {
      // ya contó hoy, no cambia el streak
    } else {
      const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      dailyStreak = last === yest ? dailyStreak + 1 : 1;
    }
  }
  const xpGain = countsForDaily
    ? 10 + Math.max(0, Math.round((puzzle.rating - stats.rating) / 100)) * 2
    : 0;
  const newXp = (stats.xp || 0) + xpGain;

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
      daily_streak: dailyStreak,
      last_solved_day: countsForDaily ? today : (stats.last_solved_day || null),
      xp: newXp,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (uErr) console.warn('[tactics.recordAttempt.update]', uErr.message);

  // 5) Append intento (best-effort). `solved` aquí = solve LIMPIO, así
  // el panel de insights y la cola de repeat tratan hint/wrong-move como
  // fallo real. `rating_delta` refleja el cambio efectivo.
  supabase.from('puzzle_attempts').insert({
    user_id: userId,
    puzzle_id: puzzleId,
    solved: cleanSolve,
    hints_used: hintsUsed,
    time_ms: timeMs,
    rating_delta: delta,
  }).then(({ error }) => {
    if (error) console.warn('[tactics.recordAttempt.insertAttempt]', error.message);
  });

  // Nota: los agregados por puzzle (popularity / success_rate) NO se
  // actualizan aquí. Se pueden recalcular offline cuando haga falta
  // (ver scripts/recompute_puzzle_aggregates.sql como referencia).
  // Quitar este paso evita warnings de RPC inexistente y ahorra 1 round-trip.

  return {
    delta,
    newRating,
    streak: newStreak,
    bestStreak: newBest,
    solved: newSolved,
    attempted: newAttempted,
    dailyStreak,
    xp: newXp,
    xpGain,
    cleanSolve,
    counted: !isRepeat,
    repeat: isRepeat,
  };
}

/* ===================== PARTE 3: Daily Puzzle ===================== */

function hashDay(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Puzzle del día — determinístico: todos los usuarios ven el mismo.
 * Se cachea en daily_puzzles para no recalcular ni cambiar a mitad del día.
 */
async function getDailyPuzzle() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from('daily_puzzles')
    .select('puzzle_id')
    .eq('day', today)
    .maybeSingle();

  let puzzleId = existing?.puzzle_id || null;

  if (!puzzleId) {
    const { data: cand } = await supabase
      .from('puzzles')
      .select('id')
      .gte('rating', 1400)
      .lte('rating', 1850)
      .order('popularity', { ascending: false })
      .limit(300);
    if (cand && cand.length) {
      puzzleId = cand[hashDay(today) % cand.length].id;
      await supabase
        .from('daily_puzzles')
        .upsert({ day: today, puzzle_id: puzzleId }, { onConflict: 'day', ignoreDuplicates: true });
    }
  }

  if (!puzzleId) throw { status: 404, message: 'No hay puzzles para el daily' };

  const { data: p, error } = await supabase
    .from('puzzles')
    .select('id, fen, moves_uci, rating, themes')
    .eq('id', puzzleId)
    .single();
  if (error || !p) throw { status: 404, message: 'Puzzle diario no encontrado' };

  const moves = p.moves_uci.split(/\s+/).filter(Boolean);
  return {
    id: p.id,
    fen: p.fen,
    rating: p.rating,
    themes: p.themes || [],
    setupMove: moves[0] || null,
    solution: moves.slice(1),
    day: today,
  };
}

/* ===================== PARTE 3: Puzzle Rush ===================== */

/**
 * Registra una corrida de Puzzle Rush. El scoring/validación de cada
 * puzzle ocurre client-side (igual que el modo normal: contenido
 * individual, no competitivo entre usuarios). Acá sólo persistimos
 * el resultado agregado para leaderboard futuro.
 */
async function submitRushRun(userId, { score, maxCombo, durationSec, mode }) {
  const s = Math.max(0, parseInt(score, 10) || 0);
  const c = Math.max(0, parseInt(maxCombo, 10) || 0);
  const d = Math.max(0, Math.min(3600, parseInt(durationSec, 10) || 0));
  const m = ['3min', '5min', 'survival'].includes(mode) ? mode : '3min';

  const { error } = await supabase
    .from('puzzle_rush_runs')
    .insert({ user_id: userId, mode: m, score: s, max_combo: c, duration_sec: d });
  if (error) {
    console.warn('[tactics.submitRushRun]', error.message);
    throw { status: 500, message: 'No se pudo registrar la corrida' };
  }

  const { data: best } = await supabase
    .from('puzzle_rush_runs')
    .select('score')
    .eq('user_id', userId)
    .eq('mode', m)
    .order('score', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { recorded: true, mode: m, score: s, best: best?.score ?? s };
}

async function getStats(userId) {
  return await getOrCreateStats(userId);
}

/* ===== PARTE 2/3/4: Panel de ejercicios (insights temporales) ===== */

const RANGE_DAYS = { '1': 1, '7': 7, '30': 30, '60': 60, '90': 90, all: null };

/**
 * Insights del usuario para un rango temporal. Todo server-side, 1 query
 * principal sobre puzzle_attempts (índice idx_attempts_user_created), +
 * 1 query a puzzles para themes del subconjunto (solo ids del rango).
 *
 * Devuelve precisión real (clean solves / intentos), reintentos,
 * pendientes de repetir, tiempo promedio, rating, y radar por tema.
 */
async function getInsights(userId, range = '30') {
  const days = RANGE_DAYS[range] !== undefined ? RANGE_DAYS[range] : 30;
  const stats = await getOrCreateStats(userId);

  let q = supabase
    .from('puzzle_attempts')
    .select('puzzle_id, solved, hints_used, time_ms, rating_delta, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(2000); // tope defensivo: 2000 intentos recientes máx
  if (days !== null) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    q = q.gte('created_at', since);
  }
  const { data: attempts, error } = await q;
  if (error) {
    console.error('[tactics.getInsights]', error);
    throw { status: 500, message: 'No se pudieron cargar los insights' };
  }

  const rows = attempts || [];
  const total = rows.length;
  const correct = rows.filter((r) => r.solved).length;
  const withHints = rows.filter((r) => r.hints_used > 0).length;
  const ratingGain = rows.reduce((a, r) => a + (r.rating_delta || 0), 0);
  const avgTimeMs = total ? Math.round(rows.reduce((a, r) => a + (r.time_ms || 0), 0) / total) : 0;

  // Reintentos / repetidos: puzzles que aparecen >1 vez en el rango.
  const seen = new Map();
  for (const r of rows) seen.set(r.puzzle_id, (seen.get(r.puzzle_id) || 0) + 1);
  const repeated = [...seen.values()].filter((c) => c > 1).length;

  // Pendientes de repetir: ids fallados que nunca aparecen resueltos limpio.
  const solvedClean = new Set(rows.filter((r) => r.solved).map((r) => r.puzzle_id));
  const pendingRepeat = [...new Set(
    rows.filter((r) => !r.solved && !solvedClean.has(r.puzzle_id)).map((r) => r.puzzle_id)
  )].length;

  // Precisión "real": clean solves / intentos. Penaliza hints y errores
  // porque `solved` en attempts ya es cleanSolve.
  const accuracy = total ? Math.round((correct / total) * 100) : null;
  const lowData = total < 10;

  // Radar por tema: necesitamos themes de los puzzles tocados en el rango.
  const ids = [...seen.keys()].slice(0, 500);
  let radar = [];
  if (ids.length) {
    const { data: pz } = await supabase
      .from('puzzles')
      .select('id, themes')
      .in('id', ids);
    const themeAgg = {}; // theme -> {correct, total}
    const byId = new Map((pz || []).map((p) => [p.id, p.themes || []]));
    for (const r of rows) {
      const ts = byId.get(r.puzzle_id) || [];
      for (const t of ts) {
        const a = themeAgg[t] || { correct: 0, total: 0 };
        a.total += 1;
        if (r.solved) a.correct += 1;
        themeAgg[t] = a;
      }
    }
    radar = Object.entries(themeAgg)
      .map(([theme, a]) => ({
        theme,
        total: a.total,
        accuracy: Math.round((a.correct / a.total) * 100),
      }))
      .filter((x) => x.total >= 2)            // ruido fuera
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);                           // top 10 por volumen
  }

  return {
    range,
    rating: stats.rating,
    rd: stats.rd,
    totalAttempts: total,
    correct,
    incorrect: total - correct,
    withHints,
    repeated,
    pendingRepeat,
    accuracy,
    avgTimeMs,
    ratingGain,
    lowData,
    radar,
  };
}

module.exports = {
  getNextPuzzle,
  recordAttempt,
  getStats,
  getDailyPuzzle,
  submitRushRun,
  getInsights,
};
