const Return = require('../models/return');
const Stock = require('../models/stock');
const Invoice = require('../models/invoice');

exports.addReturn = async (req, res) => {
    try {
        const { invoiceId, productId, customerId, quantity, reason } = req.body;

        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const product = await Stock.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found in stock' });
        }

        if (quantity > product.quantity) {
            return res.status(400).json({ message: 'Invalid return quantity' });
        }

        product.quantity += quantity;
        await product.save();


        const newReturn = await Return.create({
            invoice: invoiceId,
            customer: customerId,
            product: productId,
            quantity,
            reason,
        });


        invoice.returns.push(newReturn._id);
        await invoice.save();

        res.status(201).json({ message: 'Return added successfully', newReturn });
    } catch (error) {
        res.status(500).json({ message: 'Error processing return', error });
    }
};
