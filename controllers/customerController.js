const Customer = require('../models/customer');
const Crud = require('./crudFactory');

exports.allCustomer = Crud.getAll(Customer);
exports.createCustomer = Crud.createOne(Customer);
exports.updateCustomer = Crud.updateOne(Customer);
exports.oneCustomer = Crud.getOneByName(Customer, 'invoice returns payment transactions');
exports.oneCustomerId = Crud.getOneById(Customer);
exports.deleteCustomer = Crud.deleteOne(Customer);

exports.getCustomerStatement = async (req, res) => {
    try {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'name is required' });
        }

        // Fetch customer details
        const customer = await Customer.findOne({ name })
            .populate('transactions')
            .lean();

        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        const transactions = customer.transactions || [];

        let totalDebit = 0;
        let totalCredit = 0;

        const transactionDetails = transactions.map(transaction => {
            if (transaction.status === 'debit') {
                totalDebit += transaction.amount;
            } else if (transaction.status === 'credit') {
                totalCredit += transaction.amount;
            }

            const itemsDetails = transaction.items
                ? transaction.items.map(item => ({
                    product: item.product,
                    quantity: item.quantity,
                    price: item.price,
                }))
                : [];

            return {
                id: transaction._id,
                type: transaction.type,
                referenceId: transaction.referenceId,
                amount: transaction.amount,
                details: transaction.details,
                status: transaction.status,
                date: transaction.date,
                items: itemsDetails,
            };
        });

        const balance = totalDebit - totalCredit;

        res.status(200).json({
            customer: {
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                address: customer.address || "N/A"
            },
            totals: {
                totalDebit,
                totalCredit,
                balance,
            },
            transactions: transactionDetails,
        });
    } catch (error) {
        console.error('Error fetching customer statement:', error);
        res.status(500).json({ message: error.message });
    }
};
