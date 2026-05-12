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
      'elo_white, elo_black, error_message, created_at, started_at, completed_at'
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

module.exports = {
  createGame,
  appendMove,
  finishGame,
  getUserHistory,
  getGame,
  getAnalysis,
  enqueueAnalysis,
  deleteAnalysis,
};
