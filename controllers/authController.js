'use strict';
const mongoose = require('mongoose');
const Company = require('../models/company.model');
const User = require('../models/user.model');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { signToken } = require('../middlewares/auth');
const { sendSuccess } = require('../utils/response');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/auditLog');

// ============================================================
// Register Company + Admin
// POST /auth/register
// ============================================================
/**
 * Creates a new company and its first Admin user in one atomic transaction.
 * Returns the JWT and the one-time recovery key (shown ONCE, never stored plain).
 *
 * Body: { companyName, username, name, password }
 */
exports.registerCompany = catchAsync(async (req, res, next) => {
  const { companyName, username, name, password } = req.body;

  if (!companyName || !username || !name || !password) {
    return next(new AppError('companyName, username, name, and password are required', 400));
  }
  if (String(password).length < 8) {
    return next(new AppError('Password must be at least 8 characters', 400));
  }
  if (!/^[a-z0-9_.-]+$/.test(username.toLowerCase())) {
    return next(new AppError('Username may only contain letters, numbers, underscores, dots, hyphens', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Generate recovery key before company creation
    const { plain: recoveryKey, hash: recoveryKeyHash } =
      Company.generateRecoveryKey();

    // Create company
    const [company] = await Company.create(
      [{ name: companyName.trim(), recoveryKeyHash }],
      { session }
    );

    // Create admin user
    const [admin] = await User.create(
      [
        {
          company: company._id,
          username: username.trim().toLowerCase(),
          name: name.trim(),
          password,
          role: 'ADMIN',
        },
      ],
      { session }
    );

    await session.commitTransaction();

    const token = signToken(admin._id, company._id);
    logger.info(`Company registered: ${company.name} | Admin: ${admin.username}`);

    sendSuccess(res, 201, {
      message: 'Company registered successfully',
      data: {
        token,
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
        user: admin.toSafeJSON(),
        company: { id: company._id, name: company.name, slug: company.slug },
        // Recovery key shown ONCE — user must save it securely
        recoveryKey,
        recoveryKeyNotice:
          'IMPORTANT: Save this recovery key securely. It will never be shown again. ' +
          'You will need it if you forget your Admin password.',
      },
    });
  } catch (err) {
    await session.abortTransaction();
    if (err.code === 11000) {
      return next(new AppError('A company or user with this name already exists', 409));
    }
    throw err;
  } finally {
    session.endSession();
  }
});

// ============================================================
// Login
// POST /auth/login
// Body: { username, password, companySlug }
// ============================================================
/**
 * Username-based login within a specific company (identified by slug).
 * Offline-friendly — no email required.
 */
exports.login = catchAsync(async (req, res, next) => {
  const { username, password, companySlug } = req.body;

  if (!username || !password || !companySlug) {
    return next(new AppError('username, password, and companySlug are required', 400));
  }

  // Find company first
  const company = await Company.findOne({
    slug: companySlug.trim().toLowerCase(),
    active: true,
  });
  if (!company) {
    // Generic error — don't reveal whether company exists
    return next(new AppError('Invalid credentials', 401));
  }

  // Find user within that company
  const user = await User.findOne({
    company: company._id,
    username: username.trim().toLowerCase(),
    active: true,
  }).select('+password');

  if (!user || !(await user.correctPassword(password))) {
    return next(new AppError('Invalid credentials', 401));
  }

  const token = signToken(user._id, company._id);
  logger.info(`Login: ${user.username} @ ${company.slug}`);

  logAudit({
    req,
    action: 'LOGIN',
    module: 'AUTH',
    entityId: user._id,
    entityLabel: user.username,
    newValues: { companySlug },
  });

  sendSuccess(res, 200, {
    message: 'Logged in successfully',
    data: {
      token,
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      user: user.toSafeJSON(),
      company: { id: company._id, name: company.name, slug: company.slug },
    },
  });
});

// ============================================================
// Get current user profile
// GET /auth/me
// ============================================================
exports.me = catchAsync(async (req, res) => {
  sendSuccess(res, 200, { data: { user: req.user.toSafeJSON() } });
});

// ============================================================
// Admin — Create Accountant
// POST /auth/users
// Requires: ADMIN role
// ============================================================
exports.createUser = catchAsync(async (req, res, next) => {
  const { username, name, password } = req.body;

  if (!username || !name || !password) {
    return next(new AppError('username, name, and password are required', 400));
  }
  if (String(password).length < 8) {
    return next(new AppError('Password must be at least 8 characters', 400));
  }

  const user = await User.create({
    company: req.companyId,   // always from authenticated admin — never from body
    username: username.trim().toLowerCase(),
    name: name.trim(),
    password,
    role: 'ACCOUNTANT',       // admin can only create accountants
    createdBy: req.user._id,
  });

  logger.info(`User created: ${user.username} by ${req.user.username} @ company ${req.companyId}`);

  logAudit({
    req,
    action: 'CREATE',
    module: 'USER_MANAGEMENT',
    entityId: user._id,
    entityLabel: user.username,
    newValues: { username: user.username, name: user.name, role: user.role },
  });

  sendSuccess(res, 201, {
    message: 'User created successfully',
    data: { user: user.toSafeJSON() },
  });
});

// ============================================================
// Admin — List Users in company
// GET /auth/users
// Requires: ADMIN role
// ============================================================
exports.listUsers = catchAsync(async (req, res) => {
  const users = await User.find({ company: req.companyId }).sort('username');
  sendSuccess(res, 200, { data: { users: users.map((u) => u.toSafeJSON()) } });
});

// ============================================================
// Admin — Get One User
// GET /auth/users/:id
// Requires: ADMIN role
// ============================================================
exports.getUser = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ _id: req.params.id, company: req.companyId });
  if (!user) return next(new AppError('User not found', 404));
  sendSuccess(res, 200, { data: { user: user.toSafeJSON() } });
});

// ============================================================
// Admin — Update User (name, active)
// PATCH /auth/users/:id
// Requires: ADMIN role
// Admin cannot update their own role or another admin's role
// ============================================================
exports.updateUser = catchAsync(async (req, res, next) => {
  const { name, active } = req.body;

  // Strip dangerous fields from body
  const allowed = {};
  if (name !== undefined) allowed.name = String(name).trim();
  if (active !== undefined) allowed.active = Boolean(active);

  if (Object.keys(allowed).length === 0) {
    return next(new AppError('No valid fields to update', 400));
  }

  const user = await User.findOneAndUpdate(
    { _id: req.params.id, company: req.companyId },
    allowed,
    { new: true, runValidators: true }
  );

  if (!user) return next(new AppError('User not found', 404));

  logger.info(`User updated: ${user.username} by ${req.user.username}`);
  sendSuccess(res, 200, { data: { user: user.toSafeJSON() } });
});

// ============================================================
// Admin — Reset User Password (no email needed)
// PATCH /auth/users/:id/reset-password
// Requires: ADMIN role
// ============================================================
exports.resetUserPassword = catchAsync(async (req, res, next) => {
  const { newPassword } = req.body;

  if (!newPassword || String(newPassword).length < 8) {
    return next(new AppError('New password must be at least 8 characters', 400));
  }

  const user = await User.findOne({ _id: req.params.id, company: req.companyId });
  if (!user) return next(new AppError('User not found', 404));

  // Admin cannot reset another Admin's password — only accountants
  if (user.role === 'ADMIN' && user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Cannot reset another Admin\'s password', 403));
  }

  user.password = newPassword; // pre-save hook will hash it
  await user.save();

  logger.info(`Password reset: ${user.username} by ${req.user.username}`);

  logAudit({
    req,
    action: 'PASSWORD_RESET',
    module: 'USER_MANAGEMENT',
    entityId: user._id,
    entityLabel: user.username,
    newValues: { resetBy: req.user.username },
  });

  sendSuccess(res, 200, { message: 'Password reset successfully' });
});

// ============================================================
// Admin — Delete User (Accountant only)
// DELETE /auth/users/:id
// Requires: ADMIN role
// ============================================================
exports.deleteUser = catchAsync(async (req, res, next) => {
  // Prevent admin from deleting themselves
  if (req.params.id === req.user._id.toString()) {
    return next(new AppError('You cannot delete your own account', 400));
  }

  const user = await User.findOne({ _id: req.params.id, company: req.companyId });
  if (!user) return next(new AppError('User not found', 404));

  if (user.role === 'ADMIN') {
    return next(new AppError('Cannot delete an Admin account', 403));
  }

  // Soft deactivate — preserves audit trail of past actions by this user
  user.active = false;
  await user.save();

  logger.info(`User deactivated: ${user.username} by ${req.user.username}`);

  logAudit({
    req,
    action: 'DEACTIVATE_USER',
    module: 'USER_MANAGEMENT',
    entityId: user._id,
    entityLabel: user.username,
    oldValues: { active: true },
    newValues: { active: false },
  });

  res.status(200).json({ status: 'success', message: 'User deactivated successfully' });
});

// ============================================================
// Admin Password Recovery (offline)
// POST /auth/admin-recovery
// Body: { companySlug, username, recoveryKey, newPassword }
// ============================================================
/**
 * Flow:
 * 1. Find company by slug.
 * 2. Verify the plain recovery key against the stored hash.
 * 3. Find the ADMIN user.
 * 4. Set new password.
 * 5. Rotate the recovery key — generate a new one, store new hash, return new plain key.
 *
 * Why key rotation:
 *   - After recovery, the old key is invalid — prevents reuse if the key was leaked.
 *   - The admin receives a new key to save.
 */
exports.adminRecovery = catchAsync(async (req, res, next) => {
  const { companySlug, username, recoveryKey, newPassword } = req.body;

  if (!companySlug || !username || !recoveryKey || !newPassword) {
    return next(
      new AppError('companySlug, username, recoveryKey, and newPassword are required', 400)
    );
  }
  if (String(newPassword).length < 8) {
    return next(new AppError('New password must be at least 8 characters', 400));
  }

  // Load company WITH the recovery key hash (select: false by default)
  const company = await Company.findOne({
    slug: companySlug.trim().toLowerCase(),
    active: true,
  }).select('+recoveryKeyHash');

  // Generic error — don't reveal company existence
  if (!company || !company.verifyRecoveryKey(recoveryKey.trim())) {
    // Small deliberate delay to slow brute force
    await new Promise((r) => setTimeout(r, 1000));
    return next(new AppError('Invalid recovery credentials', 401));
  }

  // Find the admin user for this company
  const admin = await User.findOne({
    company: company._id,
    username: username.trim().toLowerCase(),
    role: 'ADMIN',
  });

  if (!admin) {
    return next(new AppError('Invalid recovery credentials', 401));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Set new password
    admin.password = newPassword;
    await admin.save({ session });

    // Rotate recovery key
    const { plain: newRecoveryKey, hash: newHash } = Company.generateRecoveryKey();
    company.recoveryKeyHash = newHash;
    await company.save({ session });

    await session.commitTransaction();

    logger.warn(`Admin password recovered for company: ${company.slug}`);

    sendSuccess(res, 200, {
      message: 'Admin password reset successfully',
      data: {
        newRecoveryKey,
        notice:
          'Your recovery key has been rotated. Save this new key securely. ' +
          'It will not be shown again.',
      },
    });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});
