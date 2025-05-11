const Invoice = require('../models/invoice');

const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

exports.financialReport = catchAsync(async (req, res, next) => {
    const { year } = req.body;

    const Year = await Invoice.aggregate([
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
                totalRevenue: { $sum: '$subtotal' },
                totalPayments: { $sum: '$amountPaid' },
                totalDiscounts: { $sum: '$discountAmount' },
            },
        },
    ]);

    res.status(200).json({ message: `Financial report for ${year}`, Year });
});



exports.getTopProducts = catchAsync(async (req, res, next) => {
    const { startDate, endDate, limit = 5 } = req.body;

    const pipeline = [
        {
            $match: {
                issueDate: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            }
        },
        { $unwind: '$items' },
        {
            $group: {
                _id: '$items.product',
                totalSold: { $sum: '$items.quantity' },
                revenue: { $sum: '$items.lineTotal' }
            }
        },
        { $sort: { totalSold: -1 } },
        { $limit: Number(limit) },
        {
            $lookup: {
                from: 'products',
                localField: '_id',
                foreignField: '_id',
                as: 'product'
            }
        },
        { $unwind: '$product' },
        {
            $project: {
                _id: 0,
                productName: '$product.name',
                totalSold: 1,
                revenue: 1
            }
        }
    ];

    const topProducts = await Invoice.aggregate(pipeline);

    res.status(200).json({
        status: 'success',
        data: topProducts
    });
});