const tacticsService = require('../services/tacticsService');

async function getNext(req, res, next) {
  try {
    const puzzle = await tacticsService.getNextPuzzle(req.user.id);
    res.json({ puzzle });
  } catch (err) { next(err); }
}

async function attempt(req, res, next) {
  try {
    const { puzzleId, solved, hintsUsed, timeMs } = req.body || {};
    if (!puzzleId || typeof solved !== 'boolean') {
      return res.status(400).json({ error: 'puzzleId y solved son requeridos' });
    }
    const result = await tacticsService.recordAttempt(req.user.id, {
      puzzleId, solved, hintsUsed, timeMs,
    });
    res.json(result);
  } catch (err) { next(err); }
}

async function stats(req, res, next) {
  try {
    const s = await tacticsService.getStats(req.user.id);
    res.json({ stats: s });
  } catch (err) { next(err); }
}

module.exports = { getNext, attempt, stats };
