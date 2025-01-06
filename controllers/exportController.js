const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Invoice = require('../models/invoice');
const Customer = require('../models/customer');


exports.exportInvoicesToPDF = async (req, res) => {
    try {
        const invoices = await Invoice.find().populate('customer', 'name email phone'); // جلب البيانات

        // إنشاء ملف PDF
        const doc = new PDFDocument();
        const filePath = path.join(__dirname, '..', 'exports', 'invoices.pdf');
        const writeStream = fs.createWriteStream(filePath);
        doc.pipe(writeStream);

        // كتابة محتوى الفاتورة
        doc.fontSize(16).text('Invoices Report', { align: 'center' });
        doc.moveDown();

        invoices.forEach((invoice, index) => {
            doc.fontSize(12).text(`Invoice #${index + 1}`, { underline: true });
            doc.text(`Invoice Number: ${invoice.invoiceNumber}`);
            doc.text(`Customer: ${invoice.customer.name}`);
            doc.text(`Total: ${invoice.total}`);
            doc.text(`Paid: ${invoice.paid}`);
            doc.text(`Remaining: ${invoice.remaining}`);
            doc.text('------------------------');
        });

        doc.end();

        writeStream.on('finish', () => {
            res.download(filePath, 'invoices.pdf');
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to export invoices to PDF', error: err.message });
    }
};




exports.exportInvoicesToExcel = async (req, res) => {
    try {
        const invoices = await Invoice.find().populate('customer', 'name email phone'); // جلب البيانات

        // إنشاء ملف Excel
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Invoices');

        // إضافة العناوين
        sheet.columns = [
            { header: 'Invoice Number', key: 'invoiceNumber', width: 20 },
            { header: 'Customer Name', key: 'customerName', width: 20 },
            { header: 'Total', key: 'total', width: 15 },
            { header: 'Paid', key: 'paid', width: 15 },
            { header: 'Remaining', key: 'remaining', width: 15 },
        ];

        // إضافة البيانات
        invoices.forEach((invoice) => {
            sheet.addRow({
                invoiceNumber: invoice.invoiceNumber,
                customerName: invoice.customer.name,
                total: invoice.total,
                paid: invoice.paid,
                remaining: invoice.remaining,
            });
        });

        const filePath = path.join(__dirname, '..', 'exports', 'invoices.xlsx');
        await workbook.xlsx.writeFile(filePath);

        res.download(filePath, 'invoices.xlsx');
    } catch (err) {
        res.status(500).json({ message: 'Failed to export invoices to Excel', error: err.message });
    }
};

exports.fileCustomerStatement = async (req, res) => {
    try {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'name is required' });
        }

        // Fetch customer details
        const customer = await Customer.findOne({ name }).populate('transactions').lean();
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

            // Format items (if any) with a hyphen-separated list
            const items = (transaction.items || [])
                .map(item => `Product: ${item.product}, Qnt: ${item.quantity}, Price: ${item.price}`)
                .join(' - ');

            return {
                id: transaction._id,
                type: transaction.type,
                referenceId: transaction.referenceId,
                amount: transaction.amount,
                details: transaction.details,
                status: transaction.status,
                date: new Date(transaction.date).toLocaleDateString(), // Formatting date
                items, // Add formatted items here
            };
        });

        const balance = totalCredit - totalDebit;

        // Create workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Customer Statement');

        // Define columns with widths and styles
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 20 },
            { header: 'Type', key: 'type', width: 15 },
            { header: 'Reference ID', key: 'referenceId', width: 20 },
            { header: 'Amount', key: 'amount', width: 15, style: { numFmt: '#,##0.00' } },
            { header: 'Details', key: 'details', width: 30 },
            { header: 'Status', key: 'status', width: 10 },
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Items', key: 'items', width: 50 }, // Add items column
        ];

        // Add transaction details to rows
        transactionDetails.forEach(transaction => {
            worksheet.addRow(transaction);
        });

        // Add totals and balance
        worksheet.addRow({});
        worksheet.addRow({ id: 'Total Debit', amount: totalDebit });
        worksheet.addRow({ id: 'Total Credit', amount: totalCredit });
        worksheet.addRow({ id: 'Balance', amount: balance });

        // Apply formatting
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell, colNumber) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                if (rowNumber === 1) {
                    cell.font = { bold: true }; // Header row
                }
            });
        });

        // Ensure exports directory exists
        const exportsDir = path.join(__dirname, '..', 'exports');
        if (!fs.existsSync(exportsDir)) {
            fs.mkdirSync(exportsDir);
        }

        const filePath = path.join(exportsDir, 'Customer.xlsx');
        await workbook.xlsx.writeFile(filePath);

        res.download(filePath, 'Customer.xlsx');
    } catch (error) {
        console.error('Error fetching customer statement:', error);
        res.status(500).json({ message: error.message });
    }
};