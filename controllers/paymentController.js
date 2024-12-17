const Payment = require('../models/payment');
const Invoice = require('../models/invoice');
const Customer = require('../models/customer');
const Transaction = require('../models/transactions');

exports.addPayment = async (req, res) => {
    try {
        const { name, amount, invoiceId } = req.body;

        const customer = await Customer.findOne({ name });
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }


        // Fetch invoice
        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Check if payment exceeds the remaining invoice amount
        const remaining = invoice.total - (invoice.paid || 0);
        if (amount > remaining) {
            return res.status(400).json({ message: `Payment exceeds remaining invoice amount. Remaining: ${remaining}` });
        }

        // Add payment
        const payment = new Payment({ customer: customer.id, customerName: name, amount, invoice: invoiceId });
        await payment.save();

        const transaction = await Transaction.create({
            type: 'payment',
            referenceId: invoice._id,
            amount,
            details: `Payment of ${amount} for invoice ${invoice._id}`,
            status: 'credit',
        });

        customer.transactions.push(transaction._id)
        customer.payment.push(payment._id);
        customer.balance += amountPaid; 
        await customer.save();

        // Update invoice's paid amount
        invoice.paid = (invoice.paid || 0) + amount;
        await invoice.save();

        res.status(201).json({
            message: 'Payment added successfully',
            payment: {
                payment,
                customer: {
                    name: customer.name,
                    email: customer.email,
                    phone: customer.phone,
                },
                invoice: {
                    items: invoice.items,
                    total: invoice.total,

                    paid: invoice.paid,
                    status: invoice.status,
                },
            },
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
