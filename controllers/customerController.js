const Invoice = require('../models/invoice');
const Payment = require('../models/payment');
const Customer = require('../models/customer');

exports.getCustomerStatement = async (req, res) => {
    try {

        // Fetch customer details
        const customer = await Customer.findOne({ email: req.body.email })
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        // Fetch invoices and payments for the customer
        const invoices = await Invoice.find({ customer: customer.email });
        const payments = await Payment.find({ customer: customer.email });

        // Calculate totals
        const totalInvoices = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
        const totalPayments = payments.reduce((sum, payment) => sum + payment.amount, 0);
        const balance = totalInvoices - totalPayments;

        res.status(200).json({
            customer: customer.name,
            totalInvoices,
            totalPayments,
            balance,
            invoices,
            payments,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
