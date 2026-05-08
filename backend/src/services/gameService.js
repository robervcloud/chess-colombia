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

module.exports = {
  createGame,
  appendMove,
  finishGame,
  getUserHistory,
  getGame,
};
