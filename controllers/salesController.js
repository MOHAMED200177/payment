const Invoice = require('../models/invoice');

exports.getSalesReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const invoices = await Invoice.find({
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
        });

        const totalSales = invoices.reduce((sum, invoice) => sum + invoice.total, 0);

        res.status(200).json({ totalSales, invoices });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
