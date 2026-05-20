/**
 * Servicio de partidas. Encapsula toda la persistencia.
 *
 * Decisión de diseño: la lógica EN VIVO de una partida (turnos,
 * tablero, movimientos) vive en memoria dentro del módulo de
 * sockets (`sockets/gameHandler.js`). Aquí sólo manejamos lo que
 * se persiste a la DB:
 *   - crear el registro de la partida cuando inicia
 *   - actualizar moves/PGN/FEN durante o al finalizar
 *   - consultar historial de un usuario
 */
const supabase = require('../config/supabase');

/**
 * Crea el registro inicial de una partida.
 * @param {{whiteId:string, blackId:string, whiteUsername:string, blackUsername:string, timeControl:string, countryFilter:string}} data
 */
async function createGame(data) {
  const { data: game, error } = await supabase
    .from('games')
    .insert({
      white_id: data.whiteId,
      black_id: data.blackId,
      white_username: data.whiteUsername,
      black_username: data.blackUsername,
      time_control: data.timeControl,
      country_filter: data.countryFilter,
      status: 'active',
    })
    .select('*')
    .single();

  if (error) {
    console.error('[gameService.createGame] Error:', error);
    throw { status: 500, message: 'No se pudo crear la partida' };
  }
  return game;
}

/**
 * Persiste un movimiento. Lo hacemos como UPDATE jsonb.
 * Para MVP: cada movimiento hace un UPDATE; aceptable hasta 100
 * partidas concurrentes. Si crece, hacer batching.
 */
async function appendMove(gameId, move, fen, pgn) {
  // Leemos los moves actuales y agregamos el nuevo
  const { data: current, error: readErr } = await supabase
    .from('games')
    .select('moves')
    .eq('id', gameId)
    .single();

  if (readErr || !current) {
    throw { status: 404, message: 'Partida no encontrada' };
  }

  const moves = Array.isArray(current.moves) ? current.moves : [];
  moves.push(move);

  const { error } = await supabase
    .from('games')
    .update({ moves, fen, pgn })
    .eq('id', gameId);

  if (error) {
    console.error('[gameService.appendMove] Error:', error);
    throw { status: 500, message: 'No se pudo guardar el movimiento' };
  }
}

/**
 * Marca la partida como terminada.
 */
async function finishGame(gameId, { result, termination, fen, pgn }) {
  const { error } = await supabase
    .from('games')
    .update({
      result,
      termination,
      fen,
      pgn,
      status: 'finished',
      ended_at: new Date().toISOString(),
    })
    .eq('id', gameId);

  if (error) {
    console.error('[gameService.finishGame] Error:', error);
    throw { status: 500, message: 'No se pudo finalizar la partida' };
  }

  // Encolar análisis post-partida (no-bloqueante).
  // Si falla la inserción (p.ej. la tabla no existe porque no se corrió la
  // migración 002, o ya existe el row), NO afectamos el resultado del juego.
  enqueueAnalysis(gameId).catch((err) => {
    console.warn('[gameService.finishGame] no se pudo encolar análisis:', err.message);
  });
}

/**
 * Crea (o reusa) un row 'pending' en game_analyses.
 * El worker se encargará de procesarlo asincrónicamente.
 */
async function enqueueAnalysis(gameId) {
  const { error } = await supabase
    .from('game_analyses')
    .insert({ game_id: gameId, status: 'pending' });
  if (error) {
    if (error.code === '23505') return; // ya existe (idempotente)
    throw new Error(error.message || 'No se pudo encolar análisis');
  }
}

/**
 * Devuelve el análisis de una partida (o null si todavía no existe el row).
 */
async function getAnalysis(gameId) {
  const { data, error } = await supabase
    .from('game_analyses')
    .select(
      'game_id, status, engine_name, engine_depth, moves_analysis, summary, ' +
      'elo_white, elo_black, elo_confidence_white, elo_confidence_black, ' +
      'elo_reasons_white, elo_reasons_black, ' +
      'progress_current, progress_total, ' +
      'error_message, created_at, started_at, completed_at'
    )
    .eq('game_id', gameId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[gameService.getAnalysis] Error:', error);
    throw { status: 500, message: 'No se pudo cargar el análisis' };
  }
  return data;
}

/**
 * Historial de un usuario (últimas N partidas).
 */
async function getUserHistory(userId, limit = 30) {
  const { data, error } = await supabase
    .from('games')
    .select(
      'id, white_id, black_id, white_username, black_username, result, status, termination, time_control, created_at, ended_at'
    )
    .or(`white_id.eq.${userId},black_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[gameService.getUserHistory] Error:', error);
    throw { status: 500, message: 'No se pudo cargar el historial' };
  }
  return data || [];
}

/**
 * Devuelve una partida (para cargar su PGN/moves).
 */
async function getGame(gameId) {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (error || !data) throw { status: 404, message: 'Partida no encontrada' };
  return data;
}

/**
 * Borra el row de análisis (NO la partida).
 * Usado por el cleanup temporal al salir de la página.
 */
async function deleteAnalysis(gameId) {
  const { error } = await supabase
    .from('game_analyses')
    .delete()
    .eq('game_id', gameId);
  if (error) {
    console.warn('[gameService.deleteAnalysis]', error.message);
    // No throw: el TTL del worker eventualmente lo limpia.
  }
}

/**
 * Aplica Glicko-2 al cierre de partida. Devuelve null si la partida es
 * vs bot (uno de los IDs faltante). Persiste rating + RD + vol del modo
 * correspondiente en `users` e inserta filas en `rating_history`.
 *
 * Se llama desde gameHandler.endGame TRAS finishGame, y el resultado se
 * emite por socket `rating:update`.
 */
async function applyRatingForGame({ whiteId, blackId, result, timeControl, gameId }) {
  if (!whiteId || !blackId) return null; // vs bot
  const rating = require('./ratingService');
  const mode = rating.modeFromTimeControl(timeControl);

  const cols = `id, rating_${mode}, rd_${mode}, vol_${mode}, games_${mode}`;
  const { data: rows, error: selErr } = await supabase
    .from('users')
    .select(cols)
    .in('id', [whiteId, blackId]);
  if (selErr || !rows) {
    console.error('[applyRatingForGame] select error:', selErr);
    return null;
  }
  const wRow = rows.find((r) => r.id === whiteId);
  const bRow = rows.find((r) => r.id === blackId);
  if (!wRow || !bRow) return null;

  const white = { rating: wRow[`rating_${mode}`], rd: wRow[`rd_${mode}`], vol: wRow[`vol_${mode}`] };
  const black = { rating: bRow[`rating_${mode}`], rd: bRow[`rd_${mode}`], vol: bRow[`vol_${mode}`] };

  const score = rating.whiteScoreFromResult(result);
  const out = rating.computeGame(white, black, score);

  const updW = {
    [`rating_${mode}`]: out.white.rating,
    [`rd_${mode}`]:     out.white.rd,
    [`vol_${mode}`]:    out.white.vol,
    [`games_${mode}`]:  (wRow[`games_${mode}`] || 0) + 1,
  };
  const updB = {
    [`rating_${mode}`]: out.black.rating,
    [`rd_${mode}`]:     out.black.rd,
    [`vol_${mode}`]:    out.black.vol,
    [`games_${mode}`]:  (bRow[`games_${mode}`] || 0) + 1,
  };
  const [uw, ub] = await Promise.all([
    supabase.from('users').update(updW).eq('id', whiteId),
    supabase.from('users').update(updB).eq('id', blackId),
  ]);
  if (uw.error) console.warn('[applyRatingForGame] update white:', uw.error.message);
  if (ub.error) console.warn('[applyRatingForGame] update black:', ub.error.message);

  // Historial (best-effort)
  supabase.from('rating_history').insert([
    { user_id: whiteId, mode, game_id: gameId, rating: out.white.rating, rd: out.white.rd, delta: out.white.rating - white.rating },
    { user_id: blackId, mode, game_id: gameId, rating: out.black.rating, rd: out.black.rd, delta: out.black.rating - black.rating },
  ]).then(({ error }) => { if (error) console.warn('[rating_history]', error.message); });

  return {
    mode,
    white: {
      userId: whiteId,
      old: white.rating,
      new: out.white.rating,
      delta: out.white.rating - white.rating,
      rd: out.white.rd,
      provisional: rating.isProvisional(out.white.rd),
    },
    black: {
      userId: blackId,
      old: black.rating,
      new: out.black.rating,
      delta: out.black.rating - black.rating,
      rd: out.black.rd,
      provisional: rating.isProvisional(out.black.rd),
    },
  };
}

module.exports = {
  createGame,
  appendMove,
  finishGame,
  getUserHistory,
  getGame,
  getAnalysis,
  enqueueAnalysis,
  deleteAnalysis,
  applyRatingForGame,
};
