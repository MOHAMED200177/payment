const express = require('express');
const authController = require('../controllers/authController');
const { protect, restrictTo } = require('../middlewares/auth');

const router = express.Router();

router.post('/login', authController.login);
router.post('/register', authController.registerBootstrap);
router.get('/me', protect, authController.me);
router.post(
  '/users',
  protect,
  restrictTo('ADMIN'),
  authController.createUser
);

module.exports = router;
