const Invoice = require('../models/invoice');

exports.financialReport = catchAsync(async (req, res, next) => {
    const { year } = req.query;

    const report = await Invoice.aggregate([
        {
            $match: {
                createdAt: {
                    $gte: new Date(`${year}-01-01`),
                    $lte: new Date(`${year}-12-31`),
                },
            },
        },
        {
            $group: {
                _id: { $month: '$createdAt' },
                totalRevenue: { $sum: '$total' },
                totalPayments: { $sum: '$paid' },
                totalDiscounts: { $sum: '$discount' },
            },
        },
    ]);

    res.status(200).json({ message: `Financial report for ${year}`, report });
});
