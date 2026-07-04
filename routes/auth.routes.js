'use strict';
const express = require('express');
const authController = require('../controllers/authController');
const { protect, restrictTo } = require('../middlewares/auth');

const router = express.Router();

// ─── Public (no auth required) ─────────────────────────────
router.post('/register', authController.registerCompany);
router.post('/login', authController.login);
router.post('/admin-recovery', authController.adminRecovery);

// ─── Authenticated ──────────────────────────────────────────
router.get('/me', protect, authController.me);

// ─── Admin only — User Management ───────────────────────────
router.use(protect, restrictTo('ADMIN'));

router.route('/users')
  .get(authController.listUsers)
  .post(authController.createUser);

router.route('/users/:id')
  .get(authController.getUser)
  .patch(authController.updateUser)
  .delete(authController.deleteUser);

router.patch('/users/:id/reset-password', authController.resetUserPassword);

module.exports = router;
