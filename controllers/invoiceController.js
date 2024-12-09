const mongoose = require('mongoose');
const Payment = require('../models/payment');
const Customer = require('../models/customer');
const Invoice = require('../models/invoice');
const Stock = require('../models/stock');

// Create new invoice
exports.createInvoice = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { name, email, phone, items, amount } = req.body;

        let customer = await Customer.findOne({ email });
        if (!customer) {
            customer = new Customer({ name, email, phone });
            await customer.save({ session });
        }


        // Calculate total and update stock
        let total = 0;
        const updatedItems = await Promise.all(items.map(async (item) => {
            const product = await Stock.findOne({ product: item.product });
            if (!product) {
                return res.status(400).json({ message: `Product not found: ${item.product}` });
            }
            if (product.quantity < item.quantity) {
                return res.status(400).json({ message: `Insufficient stock for ${product.productName}` });
            }

            product.quantity -= item.quantity;
            await product.save({ session });

            total += product.price * item.quantity;

            return {
                product_id: product._id,
                product: product.product,
                quantity: item.quantity,
                price: product.price,
            };
        }));

        // Create and save invoice
        const invoice = new Invoice({ customer: customer.id, items: updatedItems, total, paid: amount });
        await invoice.save({ session });


        const payment = new Payment({ customer: customer.id, amount, invoice: invoice.id });
        await payment.save({ session });

        await session.commitTransaction();
        session.endSession();

        const populatedInvoice = await Invoice.findById(invoice.id).populate('customer', 'name');

        res.status(201).json({
            message: 'Invoice created successfully', invoice: populatedInvoice

        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: error.message });
    }
};
