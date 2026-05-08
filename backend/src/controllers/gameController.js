const gameService = require('../services/gameService');

async function history(req, res, next) {
  try {
    const games = await gameService.getUserHistory(req.user.id);
    res.json({ games });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const game = await gameService.getGame(req.params.id);
    res.json({ game });
  } catch (err) {
    next(err);
  }
}

async function analysis(req, res, next) {
  try {
    const gameId = req.params.id;
    const game = await gameService.getGame(gameId);

    // Sólo participantes pueden ver el análisis (matchea criterio de privacidad
    // del MVP; cambiar a "cualquiera autenticado" si se quiere más abierto).
    if (game.white_id !== req.user.id && game.black_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes acceso a esta partida' });
    }

    let analysis = await gameService.getAnalysis(gameId);

    // Si la partida ya terminó pero por alguna razón no hay row de análisis
    // (p.ej. la migración 002 se corrió DESPUÉS de varias partidas), lo
    // encolamos bajo demanda. El worker lo recogerá.
    if (!analysis && game.status === 'finished') {
      try {
        await gameService.enqueueAnalysis(gameId);
        analysis = { game_id: gameId, status: 'pending' };
      } catch {
        analysis = null;
      }
    }

    res.json({ game, analysis });
  } catch (err) {
    next(err);
  }
}

module.exports = { history, getOne, analysis };
