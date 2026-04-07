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

  const user = await User.findOne({ email }).select('+password');
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

/** First admin only — when database has zero users */
exports.registerBootstrap = catchAsync(async (req, res, next) => {
  const count = await User.countDocuments();
  if (count > 0) {
    return next(
      new AppError(
        'Registration is disabled. Sign in as admin to create users.',
        403
      )
    );
  }

  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return next(new AppError('Please provide name, email, and password', 400));
  }

  const user = await User.create({
    name,
    email,
    password,
    role: 'ADMIN',
  });

  const token = signToken(user._id);
  logger.info(`Bootstrap admin created: ${user.email}`);

  sendSuccess(res, 201, {
    message: 'Administrator account created',
    data: {
      token,
      user: user.toSafeJSON(),
    },
  });
});

exports.createUser = catchAsync(async (req, res, next) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return next(new AppError('Please provide name, email, and password', 400));
  }

  if (role && !User.ROLES.includes(role)) {
    return next(
      new AppError(`Invalid role. Use one of: ${User.ROLES.join(', ')}`, 400)
    );
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return next(new AppError('Email already in use', 400));
  }

  const user = await User.create({
    name,
    email,
    password,
    role: role || 'EMPLOYEE',
  });

  logger.info(`User created by admin: ${user.email}`);

  sendSuccess(res, 201, {
    message: 'User created',
    data: { user: user.toSafeJSON() },
  });
});

exports.me = catchAsync(async (req, res) => {
  sendSuccess(res, 200, { data: { user: req.user.toSafeJSON() } });
});
