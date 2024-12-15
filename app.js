// app.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const globalErrorHandler = require('./controllers/globalError');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
// Routes
const customerRoutes = require('./routes/customerRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const returnRoutes = require('./routes/returnRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const stockRoutes = require('./routes/stockRoutes');


app.use('/customers', customerRoutes);
app.use('/invoices', invoiceRoutes);
app.use('/pay', paymentRoutes);
app.use('/return', returnRoutes);
app.use('/stock', stockRoutes);

app.use(globalErrorHandler);

module.exports = app;
