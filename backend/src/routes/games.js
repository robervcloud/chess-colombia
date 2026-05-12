const express = require('express');
const ctrl = require('../controllers/gameController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/history', authRequired, ctrl.history);
router.get('/bots', authRequired, ctrl.listBots);
router.post('/bot', authRequired, ctrl.createBotGame);
router.get('/:id', authRequired, ctrl.getOne);
router.get('/:id/analysis', authRequired, ctrl.analysis);
router.delete('/:id/analysis', authRequired, ctrl.deleteAnalysis);

module.exports = router;
