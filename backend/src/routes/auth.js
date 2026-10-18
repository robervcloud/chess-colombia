const express = require('express');
const ctrl = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');
const { authLimiter, guestLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/register', authLimiter, ctrl.register);
router.post('/login', authLimiter, ctrl.login);
router.post('/google', authLimiter, ctrl.googleAuth);
router.post('/guest', guestLimiter, ctrl.guest);
router.get('/me', authRequired, ctrl.me);

module.exports = router;
