'use strict';
const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');
const ExcelJS     = require('exceljs');
const Invoice     = require('../models/invoice');
const Customer    = require('../models/customer');
const AppError    = require('../utils/appError');
const catchAsync  = require('../utils/catchAsync');

// ── Helpers ──────────────────────────────────────────────────
const formatInvoiceNumber = (num) => `INV-${num.toString().padStart(6, '0')}`;
const sanitizeFileName = (name) => name.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').replace(/\s+/g, '_').substring(0, 50);
const ensureExportsDir = () => {
  const dir = path.join(__dirname, '..', 'exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const getStatusColor = (status) => ({ paid: 'D4EDDA', partially_paid: 'FFF3CD', overdue: 'F8D7DA', cancelled: 'E2E3E5', draft: 'D1ECF1', issued: 'D1ECF1', refunded: 'E2E3E5' }[status] || 'FFFFFF');

// ============================================================
// Export Invoices to PDF — tenant-scoped
// ============================================================
exports.exportInvoicesToPDF = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.body;
  const companyId = req.companyId;

  const filter = { company: companyId };
  if (startDate && endDate) {
    const start = new Date(startDate); const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return next(new AppError('Invalid date format', 400));
    filter.createdAt = { $gte: start, $lte: end };
  }

  const invoices = await Invoice.find(filter)
    .populate({ path: 'customer', select: 'name email phone address' })
    .populate({ path: 'items.product', select: 'name productCode' });

  if (!invoices.length) return next(new AppError('No invoices found for the selected period', 404));

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const exportsDir = ensureExportsDir();
  const fileName = `invoices_report_${new Date().toISOString().split('T')[0]}.pdf`;
  const filePath = path.join(exportsDir, fileName);
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(24).font('Helvetica-Bold').text('INVOICES REPORT', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown(2);

  invoices.forEach((invoice, index) => {
    if (index > 0) doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold').text(`Invoice: ${invoice.formattedInvoiceNumber}`, { underline: true });
    doc.moveDown();
    doc.fontSize(10).font('Helvetica');
    doc.text(`Customer: ${invoice.customer?.name || 'N/A'}`);
    doc.text(`Issue Date: ${new Date(invoice.issueDate).toLocaleDateString()}`);
    doc.text(`Status: ${invoice.status?.replace(/_/g, ' ').toUpperCase()}`);
    doc.text(`Total: ${invoice.totalAmount?.toFixed(2)}`);
    doc.text(`Balance Due: ${invoice.balanceDue?.toFixed(2)}`);
  });

  doc.end();
  writeStream.on('finish', () => {
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading file:', err);
      fs.unlink(filePath, () => {});
    });
  });
});

// ============================================================
// Export Invoices to Excel — tenant-scoped
// ============================================================
exports.exportInvoicesToExcel = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.body;
  const companyId = req.companyId;

  const filter = { company: companyId };
  if (startDate && endDate) {
    const start = new Date(startDate); const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return next(new AppError('Invalid date format', 400));
    filter.createdAt = { $gte: start, $lte: end };
  }

  const invoices = await Invoice.find(filter)
    .populate({ path: 'customer', select: 'name email phone address' })
    .populate({ path: 'items.product', select: 'name productCode' });

  if (!invoices.length) return next(new AppError('No invoices found for the selected period', 404));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Invoices Report');

  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = 'INVOICES REPORT';
  sheet.getCell('A1').font = { bold: true, size: 18 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.columns = [
    { header: 'Invoice Number', key: 'invoiceNumber', width: 20 },
    { header: 'Customer Name',  key: 'customerName',  width: 25 },
    { header: 'Issue Date',     key: 'issueDate',     width: 15 },
    { header: 'Due Date',       key: 'dueDate',       width: 15 },
    { header: 'Status',         key: 'status',        width: 15 },
    { header: 'Total Amount',   key: 'totalAmount',   width: 15 },
    { header: 'Amount Paid',    key: 'amountPaid',    width: 15 },
    { header: 'Balance Due',    key: 'balanceDue',    width: 15 },
  ];

  sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFF' } };
  sheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0A0F4D' } };

  invoices.forEach((invoice) => {
    const row = sheet.addRow({
      invoiceNumber: invoice.formattedInvoiceNumber,
      customerName:  invoice.customer?.name || 'N/A',
      issueDate:     new Date(invoice.issueDate).toLocaleDateString(),
      dueDate:       new Date(invoice.dueDate).toLocaleDateString(),
      status:        invoice.status?.replace(/_/g, ' ').toUpperCase() || 'N/A',
      totalAmount:   invoice.totalAmount || 0,
      amountPaid:    invoice.amountPaid || 0,
      balanceDue:    invoice.balanceDue || 0,
    });
    row.getCell('totalAmount').numFmt = '$#,##0.00';
    row.getCell('amountPaid').numFmt  = '$#,##0.00';
    row.getCell('balanceDue').numFmt  = '$#,##0.00';
    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getStatusColor(invoice.status) } };
  });

  const exportsDir = ensureExportsDir();
  const fileName = `invoices_report_${new Date().toISOString().split('T')[0]}.xlsx`;
  const filePath = path.join(exportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);
  res.download(filePath, fileName, (err) => { if (err) console.error(err); fs.unlink(filePath, () => {}); });
});

// ============================================================
// Customer Statement Excel — tenant-scoped
// ============================================================
exports.fileCustomerStatement = catchAsync(async (req, res, next) => {
  const { name } = req.body;
  const companyId = req.companyId;
  if (!name) return next(new AppError('Customer name is required', 400));

  const customer = await Customer.findOne({ name, company: companyId })
    .populate({ path: 'transactions', populate: [{ path: 'items.product', select: 'name productCode' }] }).lean();

  if (!customer) return next(new AppError('Customer not found', 404));

  const transactions = customer.transactions || [];
  let totalDebit = 0, totalCredit = 0, runningBalance = 0;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Customer Statement');

  worksheet.mergeCells('A1:H1');
  worksheet.getCell('A1').value = 'CUSTOMER ACCOUNT STATEMENT';
  worksheet.getCell('A1').font = { bold: true, size: 18 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  worksheet.getCell('A4').value = 'Customer:'; worksheet.getCell('B4').value = customer.name;
  worksheet.getCell('A5').value = 'Phone:';    worksheet.getCell('B5').value = customer.phone || 'N/A';
  worksheet.getCell('A6').value = 'Balance:';  worksheet.getCell('B6').value = customer.outstandingBalance || 0;
  worksheet.getCell('B6').numFmt = '$#,##0.00';

  worksheet.columns = [
    { header: 'Date',        key: 'date',        width: 15 },
    { header: 'Type',        key: 'type',        width: 15 },
    { header: 'Description', key: 'description', width: 35 },
    { header: 'Debit',       key: 'debit',       width: 15 },
    { header: 'Credit',      key: 'credit',      width: 15 },
    { header: 'Balance',     key: 'balance',     width: 15 },
  ];

  const headerRow = 8;
  worksheet.getRow(headerRow).font = { bold: true, color: { argb: 'FFFFFF' } };
  worksheet.getRow(headerRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0A0F4D' } };

  transactions.forEach((t) => {
    const debit  = t.status === 'debit'  ? t.amount : 0;
    const credit = t.status === 'credit' ? t.amount : 0;
    runningBalance += credit - debit;
    totalDebit  += debit;
    totalCredit += credit;

    const row = worksheet.addRow({
      date: new Date(t.date).toLocaleDateString(),
      type: t.type,
      description: t.details || 'N/A',
      debit:   debit  > 0 ? debit  : '',
      credit:  credit > 0 ? credit : '',
      balance: runningBalance,
    });
    if (debit  > 0) { row.getCell('debit').numFmt  = '$#,##0.00'; row.getCell('debit').font  = { color: { argb: 'DC3545' } }; }
    if (credit > 0) { row.getCell('credit').numFmt = '$#,##0.00'; row.getCell('credit').font = { color: { argb: '28A745' } }; }
    row.getCell('balance').numFmt = '$#,##0.00';
    row.getCell('balance').font = { color: { argb: runningBalance < 0 ? 'DC3545' : '28A745' } };
  });

  const totals = worksheet.addRow({ description: 'TOTALS', debit: totalDebit, credit: totalCredit, balance: runningBalance });
  totals.font = { bold: true };
  totals.getCell('debit').numFmt = totals.getCell('credit').numFmt = totals.getCell('balance').numFmt = '$#,##0.00';

  const exportsDir = ensureExportsDir();
  const safeName = sanitizeFileName(customer.name);
  const fileName = `${safeName}_Statement_${new Date().toISOString().split('T')[0]}.xlsx`;
  const filePath = path.join(exportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);
  res.download(filePath, fileName, (err) => { if (err) console.error(err); fs.unlink(filePath, () => {}); });
});
