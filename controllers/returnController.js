const Return = require('../models/return');
const Customer = require('../models/customer');
const Stock = require('../models/stock');
const Invoice = require('../models/invoice');
const Transaction = require('../models/transactions');
const Crud = require('./crudFactory');

exports.allReturn = Crud.getAll(Return);
exports.updateReturn = Crud.updateOne(Return);
exports.oneReturn = Crud.getOne(Return);
exports.deleteReturn = Crud.deleteOne(Return);

exports.addReturn = async (req, res) => {
    try {
        const { invoiceId, productName, name, quantity, reason } = req.body;

        const customer = await Customer.findOne({ name })
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const product = await Stock.findOne({ product: productName });
        if (!product) {
            return res.status(404).json({ message: 'Product not found in stock' });
        }

        const invoiceItem = invoice.items.find(item => item.product_id.toString() === product._id.toString());
        if (!invoiceItem || quantity > invoiceItem.quantity) {
            return res.status(400).json({ message: 'Invalid return quantity' });
        }

        const refundAmount = product.price * quantity;

        customer.balance -= refundAmount;


        product.quantity += quantity;
        await product.save();


        const newReturn = await Return.create({
            invoice: invoice._id,
            customer: customer._id,
            product: product._id,
            quantity,
            reason,
        });


        invoice.returns.push(newReturn._id);
        invoice.refunds = (invoice.refunds || 0) + refundAmount;
        invoice.total -= refundAmount;
        invoice.remaining -= refundAmount;
        await invoice.save();

        const refundTransaction = await Transaction.create({
            type: 'return',
            referenceId: newReturn._id,
            amount: -refundAmount,
            details: `Refund of ${refundAmount} for returned quantity of ${quantity} from invoice ${invoice._id}`,
            status: 'debit',
        });

        customer.transactions.push(refundTransaction._id);
        customer.returns.push(newReturn._id);
        customer.balance += -refundAmount;
        await customer.save();


        res.status(201).json({
            message: 'Return added successfully',
            invoice: invoice,
            customer: customer,
            product: product,
            quantity,
            reason,
        });

    } catch (error) {
        res.status(500).json({ message: 'Error processing return', error });
    }
};
