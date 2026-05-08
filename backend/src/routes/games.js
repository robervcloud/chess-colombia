const express = require('express');
const ctrl = require('../controllers/gameController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/history', authRequired, ctrl.history);
router.get('/:id', authRequired, ctrl.getOne);

module.exports = router;
