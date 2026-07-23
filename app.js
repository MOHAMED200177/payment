'use strict';
// app.js — Multi-Tenant ERP API gateway
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
const { injectTenant } = require('./middlewares/tenant');
const app = express();

// ─── Security & parsing ─────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

// NoSQL injection guard — strip $ keys from body/query/params
app.use((req, _res, next) => {
  const sanitize = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (key.startsWith('$')) delete obj[key];
        else sanitize(obj[key]);
      }
    }
  };
  sanitize(req.body);
  sanitize(req.query);
  sanitize(req.params);
  next();
});

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
// const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
app.use('/auth', authRoutes);

// ─── ERP protected routes ─────────────────────────────────────
// Every ERP route goes through:
//   1. protect     — validates JWT, loads req.user + req.companyId
//   2. injectTenant — sets req.tenantFilter + injects company into req.body
//
// This two-step chain means ALL queries below are automatically
// isolated to the authenticated company.

const erpAuth = [protect, injectTenant];

const customerRoutes    = require('./routes/customerRoutes');
const invoiceRoutes     = require('./routes/invoiceRoutes');
const returnRoutes      = require('./routes/returnRoutes');
const paymentRoutes     = require('./routes/paymentRoutes');
const stockRoutes       = require('./routes/stockRoutes');
const productRoutes     = require('./routes/productRoutes');
const categoryRoutes    = require('./routes/categoryRoutes');
const supplierRoutes    = require('./routes/supplierRoutes');
const reportsRoutes     = require('./routes/reports.routes');
const purchaseOrderRoutes = require('./routes/purchaseOrder.routes');
const expenseRoutes     = require('./routes/expense.routes');
const cashRoutes        = require('./routes/cash.routes');
const dashboardRoutes   = require('./routes/dashboard.routes');

app.use('/customers',      erpAuth, customerRoutes);
app.use('/invoices',       erpAuth, invoiceRoutes);
app.use('/payment',        erpAuth, paymentRoutes);
app.use('/return',         erpAuth, returnRoutes);
app.use('/stock',          erpAuth, stockRoutes);
app.use('/product',        erpAuth, productRoutes);
app.use('/categories',     erpAuth, categoryRoutes);
app.use('/supplier',       erpAuth, supplierRoutes);
app.use('/reports',        erpAuth, reportsRoutes);
app.use('/purchase-orders', erpAuth, purchaseOrderRoutes);
app.use('/expenses',       erpAuth, expenseRoutes);
app.use('/cash',           erpAuth, cashRoutes);
app.use('/dashboard',      erpAuth, dashboardRoutes);

// ─── 404 ─────────────────────────────────────────────────────
app.all('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`,
  });
});

app.use(globalErrorHandler);

module.exports = app;
