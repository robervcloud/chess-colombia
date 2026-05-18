const express = require('express');
const ctrl = require('../controllers/tacticsController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/next',     authRequired, ctrl.getNext);
router.post('/attempt', authRequired, ctrl.attempt);
router.get('/stats',    authRequired, ctrl.stats);
router.get('/daily',    authRequired, ctrl.daily);
router.post('/rush',    authRequired, ctrl.rush);

module.exports = router;
