const Invoice = require('../models/invoice');
const Payment = require('../models/payment');
const Customer = require('../models/customer');
const Return = require('../models/return');

exports.getCustomerStatement = async (req, res) => {
    try {
        const { email } = req.body;

        // Fetch customer details
        const customer = await Customer.findOne({ email });
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        // Fetch invoices, payments, and returns for the customer
        const invoices = await Invoice.find({ customer: customer._id }).lean();
        const payments = await Payment.find({ customer: customer._id }).lean();
        const returns = await Return.find({ customer: customer._id }).lean();

        // Calculate totals
        const totalInvoices = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
        const totalPayments = payments.reduce((sum, payment) => sum + payment.amount, 0);
        const totalRefunds = invoices.reduce((sum, invoice) => sum + (invoice.refunds || 0), 0);
        const balance = totalPayments - totalInvoices;

        // Add detailed return information
        const detailedReturns = returns.map(ret => ({
            product: ret.product,
            quantity: ret.quantity,
            reason: ret.reason,
            date: ret.createdAt,
        }));

        res.status(200).json({
            customer: {
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
            },
            totals: {
                totalInvoices,
                totalPayments,
                totalRefunds,
                balance,
            },
            invoices: invoices.map(invoice => ({
                id: invoice._id,
                total: invoice.total,
                paid: invoice.paid,
                refunds: invoice.refunds || 0,
                status: invoice.status,
                date: invoice.createdAt,
            })),
            payments: payments.map(payment => ({
                id: payment._id,
                amount: payment.amount,
                date: payment.createdAt,
            })),
            returns: detailedReturns,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
