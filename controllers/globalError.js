const AppError = require('./../utils/appError');
const logger   = require('./../utils/logger');

const handleCastErrorDB        = (err) => new AppError(`Invalid ${err.path}: ${err.value}.`, 400);
const handleDuplicateFieldsDB  = (err) => {
  const field = Object.keys(err.keyValue || {})[0];
  const value = err.keyValue?.[field];
  return new AppError(`Duplicate value: "${value}" for field "${field}". Please use another value!`, 400);
};
const handleValidationErrorDB  = (err) => new AppError(`Invalid input data. ${Object.values(err.errors).map(e => e.message).join('. ')}`, 400);
const handleJWTError           = () => new AppError('Invalid token. Please log in again!', 401);
const handleJWTExpiredError    = () => new AppError('Your token has expired! Please log in again.', 401);

const sendErrorDev  = (err, res) => res.status(err.statusCode).json({ status: err.status, error: err, message: err.message, stack: err.stack });
const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({ status: err.status, success: false, message: err.message });
  } else {
    logger.error("Unhandled Error:", err);
    // NEVER expose raw technical errors to the client in production!
    res.status(500).json({ status: 'error', success: false, message: 'Something went very wrong on the server.' });
  }
};

module.exports = (err, req, res, next) => {
  console.error("GLOBAL_ERROR_HANDLER_LOG:", err);
  err.statusCode = err.statusCode || 500;
  err.status     = err.status || 'error';
  if (process.env.NODE_ENV === 'development') return sendErrorDev(err, res);
  let error = err;
  if (error.name === 'CastError')         error = handleCastErrorDB(error);
  else if (error.code === 11000)           error = handleDuplicateFieldsDB(error);
  else if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
  else if (error.name === 'JsonWebTokenError') error = handleJWTError();
  else if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
  sendErrorProd(error, res);
};
