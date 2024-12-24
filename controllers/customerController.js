const Customer = require('../models/customer');
const Crud = require('./crudFactory');

exports.allCustomer = Crud.getAll(Customer);
exports.createCustomer = Crud.createOne(Customer);
exports.updateCustomer = Crud.updateOne(Customer);
exports.oneCustomer = Crud.getOne(Customer);
exports.deleteCustomer = Crud.deleteOne(Customer);

exports.getCustomerStatement = async (req, res) => {
    try {
        const { email } = req.body;

        // Fetch customer details
        const customer = await Customer.findOne({ email }).populate('transactions').lean();
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        // Fetch transactions directly from customer
        const transactions = customer.transactions;

        // Calculate totals
        let totalDebit = 0; // Total amounts debited (e.g., invoices)
        let totalCredit = 0; // Total amounts credited (e.g., payments, returns)

        const transactionDetails = transactions.map(transaction => {
            if (transaction.status === 'debit') {
                totalDebit += transaction.amount;
            } else if (transaction.status === 'credit') {
                totalCredit += transaction.amount;
            }

            return {
                id: transaction._id,
                type: transaction.type,
                referenceId: transaction.referenceId,
                amount: transaction.amount,
                details: transaction.details,
                status: transaction.status,
                date: transaction.createdAt,
            };
        });

        // Calculate final balance
        const balance = totalCredit - totalDebit;

        res.status(200).json({
            customer: {
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
            },
            totals: {
                totalDebit,
                totalCredit,
                balance,
            },
            transactions: transactionDetails,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
