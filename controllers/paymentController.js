const Payment = require('../models/payment');
const Invoice = require('../models/invoice');
const Customer = require('../models/customer');

exports.addPayment = async (req, res) => {
    try {
        const { email, amount, invoiceId } = req.body;

        const customer = await Customer.findOne({ email });
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
        const payment = new Payment({ customer: customer.id, amount, invoice: invoiceId });
        await payment.save();

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
