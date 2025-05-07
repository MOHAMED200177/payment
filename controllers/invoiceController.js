const mongoose = require('mongoose');

const Crud = require('./crudFactory');
const Payment = require('../models/payment');
const Customer = require('../models/customer');
const Invoice = require('../models/invoice');
const Stock = require('../models/stock');
const Product = require('../models/product');
const Transaction = require('../models/transactions');

const invoiceSchema = require('../validations/invoiceValidation');
const getNextSequence = require('../utils/getNextSequence');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// CRUD Operations
exports.allInvoives = Crud.getAll(Invoice);
exports.updateInvoice = Crud.updateOne(Invoice);
exports.oneInvoice = Crud.getOneById(Invoice, { path: 'customer', select: 'name' });
exports.deleteInvoice = Crud.deleteOne(Invoice);

// Create new invoice
exports.createInvoice = catchAsync(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { name, email, phone, items, amount, discount } = req.body;

        const { error } = invoiceSchema.validate(req.body, { abortEarly: false });
        if (error) {
            const messages = error.details.map(detail => detail.message).join(', ');
            throw new AppError(messages, 400);
        }

        if (amount < 0) {
            throw new AppError('Payment amount cannot be negative', 400);
        }

        // Step 2: Handle customer
        let customer = await Customer.findOne({ name }).session(session);

        if (!customer) {
            if (!email || !phone) {
                throw new AppError('Email and phone are required for new customers.', 400);
            }
            customer = new Customer({ name, email, phone });
            await customer.save({ session });
        } else {
            customer.name = name ?? customer.name;
            customer.email = email ?? customer.email;
            customer.phone = phone ?? customer.phone;

            if (customer.isModified()) {
                await customer.save({ session });
            }
        }
        // Step 3: Optimized stock update and total calculation
        const processedItems = [];
        const stockUpdates = [];
        let subtotal = 0;

        // Get all product names from items
        const productNames = items.map(item => item.product);

        // Fetch all products in one query
        const products = await Product.find({ name: { $in: productNames } }).session(session);
        if (products.length !== productNames.length) {
            const foundNames = products.map(p => p.name);
            const missing = productNames.filter(name => !foundNames.includes(name));
            throw new AppError(`Products not found: ${missing.join(', ')}`, 404);
        }

        // Map products by name for fast lookup
        const productMap = new Map(products.map(p => [p.name, p]));

        // Fetch all stock records in one query
        const productIds = products.map(p => p._id);
        const stocks = await Stock.find({ product: { $in: productIds } }).populate('product').session(session);

        // Map stocks by product ID
        const stockMap = new Map(stocks.map(s => [s.product._id.toString(), s]));

        for (const item of items) {
            if (item.quantity <= 0 || !Number.isInteger(item.quantity)) {
                throw new AppError(`Invalid quantity for product: ${item.product}`, 400);
            }

            const product = productMap.get(item.product);
            if (!product) throw new AppError(`Product not found: ${item.product}`, 404);

            const stock = stockMap.get(product._id.toString());
            if (!stock) throw new AppError(`Stock not found for product: ${item.product}`, 404);

            if (stock.quantity < item.quantity) {
                throw new AppError(`Insufficient stock for ${product.name}. Available: ${stock.quantity}`, 400);
            }

            // Calculate line total
            const lineTotal = product.sellingPrice * item.quantity;
            subtotal += lineTotal;

            // Prepare processed item
            processedItems.push({
                product: product._id,
                quantity: item.quantity,
                unitPrice: product.sellingPrice,
                taxRate: product.taxes || 0,
                lineTotal
            });

            // Prepare stock update
            stockUpdates.push({
                updateOne: {
                    filter: { _id: stock._id },
                    update: {
                        $inc: { quantity: -item.quantity },
                        $set: { lastStockUpdate: new Date() }
                    }
                }
            });
        }

        // Apply all stock updates
        if (stockUpdates.length > 0) {
            await Stock.bulkWrite(stockUpdates, { session });
        }

        // Step 4: Calculate discount and totals
        let discountAmount = 0;

        if (discount) {
            if (discount < 0 || discount > 100) {
                throw new AppError('Discount must be between 0 and 100.', 400);
            }
            discountAmount = subtotal * (discount / 100);
        }

        const totalAfterDiscount = subtotal - discountAmount;

        if (amount > totalAfterDiscount) {
            throw new AppError(`Payment amount (${amount}) exceeds total invoice amount (${totalAfterDiscount})`, 400);
        }

        const remaining = totalAfterDiscount - amount;

        // Step 5: Generate Invoice Number
        let invoiceNumber;
        try {
            invoiceNumber = await getNextSequence('invoice', session);
        } catch (err) {
            throw new AppError('Failed to generate invoice number.', 500);
        }

        // Calculate due date (30 days from now by default)
        const issueDate = new Date();
        const dueDate = new Date(issueDate);
        dueDate.setDate(dueDate.getDate() + 30); // Default to NET 30

        // Step 6: Create invoice
        const invoice = new Invoice({
            invoiceNumber,
            customer: customer._id,
            items: processedItems,
            subtotal,
            taxAmount: 0,
            discountAmount,
            totalAmount: totalAfterDiscount,
            amountPaid: amount,
            balanceDue: remaining,
            issueDate,
            dueDate,
            paymentTerms: 'net_30',
        });

        // Step 7: Save with error handling
        try {
            await invoice.save({ session });
        } catch (err) {
            if (err.code === 11000 && err.keyPattern?.invoiceNumber) {
                throw new AppError('Invoice number already exists. Please try again.', 400);
            }
            throw err;
        }

        // Step 8: Create payment
        const payment = new Payment({
            customer: customer._id,
            customerName: name,
            amount,
            invoice: invoice._id
        });
        await payment.save({ session });

        // Step 9: Create transactions
        const transactions = [
            {
                type: 'invoice',
                referenceId: invoice._id,
                amount: subtotal,
                details: `Invoice #${invoice.formattedInvoiceNumber} created with total ${subtotal} for customer ${customer.name}`,
                items: processedItems.map(item => ({
                    product: item.product,
                    quantity: item.quantity,
                    price: item.unitPrice
                })),
                status: 'debit'
            }
        ];

        // Add discount transaction if applicable
        if (discountAmount > 0) {
            transactions.push({
                type: 'discount',
                referenceId: invoice._id,
                amount: discountAmount,
                details: `Discount of ${discount}% applied to invoice #${invoice.formattedInvoiceNumber}`,
                items: [],
                status: 'credit'
            });
        }

        // Add payment transaction if applicable
        if (amount > 0) {
            transactions.push({
                type: 'payment',
                referenceId: invoice._id,
                amount,
                details: `Payment of ${amount} received for invoice #${invoice.formattedInvoiceNumber}`,
                items: [],
                status: 'credit'
            });
        }

        const createdTransactions = await Transaction.insertMany(transactions, { session });

        // Step 10: Update customer data
        if (!customer.transactions) customer.transactions = [];
        if (!customer.invoice) customer.invoice = [];
        if (!customer.payment) customer.payment = [];

        customer.transactions.push(...createdTransactions.map(t => t._id));
        customer.invoice.push(invoice._id);
        customer.payment.push(payment._id);

        // Update customer balance
        if (!customer.outstandingBalance) customer.outstandingBalance = 0;
        if (!customer.balance) customer.balance = 0;

        customer.outstandingBalance += remaining;
        customer.balance += remaining;

        await customer.save({ session });

        await session.commitTransaction();

        res.status(201).json({
            status: 'success',
            message: 'Invoice created successfully',
            invoice: {
                ...invoice.toObject(),
                customer: {
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email
                }
            }
        });
    } catch (error) {
        await session.abortTransaction();
        if (error instanceof AppError) {
            next(error);
        } else {
            console.error('Invoice creation error:', error);
            next(new AppError('Something went wrong during invoice creation', 500));
        }
    } finally {
        session.endSession();
    }
});