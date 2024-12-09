// app.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(bodyParser.json());

// Routes
const customerRoutes = require('./routes/customerRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const stockRoutes = require('./routes/stockRoutes');


app.use('/customers', customerRoutes);
app.use('/invoices', invoiceRoutes);
app.use('/pay', paymentRoutes);
app.use('/stock', stockRoutes);

module.exports = app;
