// app.js — ERP API gateway
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const globalErrorHandler = require('./controllers/globalError');
const logger = require('./utils/logger');
const openapi = require('./config/openapi');
const { protect } = require('./middlewares/auth');

const app = express();

// ─── Security & parsing ─────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  })
);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 400,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ─── Public ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
  });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));

const authRoutes = require('./routes/auth.routes');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
});
app.use('/auth', authLimiter, authRoutes);

// ─── Protected ERP modules ───────────────────────────────────
const customerRoutes = require('./routes/customerRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const returnRoutes = require('./routes/returnRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const stockRoutes = require('./routes/stockRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const salesRoutes = require('./routes/salesRoutes');
const reportsRoutes = require('./routes/reports.routes');
const purchaseOrderRoutes = require('./routes/purchaseOrder.routes');

app.use('/customers', protect, customerRoutes);
app.use('/invoices', protect, invoiceRoutes);
app.use('/payment', protect, paymentRoutes);
app.use('/return', protect, returnRoutes);
app.use('/stock', protect, stockRoutes);
app.use('/product', protect, productRoutes);
app.use('/categories', protect, categoryRoutes);
app.use('/supplier', protect, supplierRoutes);
app.use('/sales', salesRoutes);
app.use('/reports', protect, reportsRoutes);
app.use('/purchase-orders', protect, purchaseOrderRoutes);

app.use(globalErrorHandler);

module.exports = app;
