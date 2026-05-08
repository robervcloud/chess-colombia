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

module.exports = { history, getOne };
