'use strict';
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

// ============================================================
// Token utilities
// ============================================================

/**
 * Sign a JWT.
 * Payload carries BOTH user id AND company id so every request
 * has tenant context without an extra DB round-trip.
 */
const signToken = (userId, companyId) =>
  jwt.sign(
    { id: userId, company: companyId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

exports.signToken = signToken;

// ============================================================
// protect — verifies JWT and loads req.user + req.companyId
// ============================================================
exports.protect = catchAsync(async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return next(new AppError('You are not logged in. Please log in to get access.', 401));
  }

  // Verify signature and expiry
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Your session has expired. Please log in again.', 401));
    }
    return next(new AppError('Invalid token. Please log in again.', 401));
  }

  // Load user — verify still exists and is active
  const user = await User.findById(decoded.id).select('+active');
  if (!user || !user.active) {
    return next(new AppError('The user belonging to this token no longer exists or has been disabled.', 401));
  }

  // Verify token company matches user's company (prevents token reuse across tenants)
  if (user.company.toString() !== decoded.company?.toString()) {
    return next(new AppError('Token is invalid for this account.', 401));
  }

  // Attach to request — downstream code reads these
  req.user = user;
  req.companyId = user.company; // ObjectId, always authoritative from DB (not token)

  next();
});

// ============================================================
// restrictTo — Role-Based Access Control
// ============================================================
/**
 * Usage: router.delete('/:id', protect, restrictTo('ADMIN'), handler)
 */
exports.restrictTo = (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }
    next();
  };
