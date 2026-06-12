const express = require('express');
const authController = require('../controllers/authController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.post('/login', authController.login);
router.post('/register', authController.register);
router.get('/me', protect, authController.me);

module.exports = router;
