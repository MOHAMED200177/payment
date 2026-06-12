const User = require('../models/user.model');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { signToken } = require('../middlewares/auth');
const { sendSuccess } = require('../utils/response');
const logger = require('../utils/logger');

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select(
    '+password'
  );
  if (!user || !(await user.correctPassword(password))) {
    return next(new AppError('Incorrect email or password', 401));
  }

  const token = signToken(user._id);
  logger.info(`User login: ${user.email}`);

  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  sendSuccess(res, 200, {
    message: 'Logged in successfully',
    data: {
      token,
      expiresIn,
      user: user.toSafeJSON(),
    },
  });
});

/**
 * Public signup — any user may register (email unique).
 * No "first admin only" or tenant gate.
 */
exports.register = catchAsync(async (req, res, next) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return next(new AppError('Please provide name, email, and password', 400));
  }
  if (String(password).length < 8) {
    return next(new AppError('Password must be at least 8 characters', 400));
  }

  const emailNorm = String(email).trim().toLowerCase();
  const existing = await User.findOne({ email: emailNorm });
  if (existing) {
    return next(new AppError('An account with this email already exists', 409));
  }

  const user = await User.create({
    name: String(name).trim(),
    email: emailNorm,
    password,
    role: 'USER',
  });

  const token = signToken(user._id);
  logger.info(`User registered: ${user.email}`);

  sendSuccess(res, 201, {
    message: 'Account created successfully',
    data: {
      token,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      user: user.toSafeJSON(),
    },
  });
});

exports.me = catchAsync(async (req, res) => {
  sendSuccess(res, 200, { data: { user: req.user.toSafeJSON() } });
});
