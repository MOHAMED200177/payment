const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Invoice = require('../models/invoice');
const Customer = require('../models/customer');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// ============================================================
// Helper Functions
// ============================================================

// ✅ Format Invoice Number بدون virtual
const formatInvoiceNumber = (num) => `INV-${num.toString().padStart(6, '0')}`;

// ✅ Sanitize filename
const sanitizeFileName = (name) =>
  name
    .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);

// ✅ Ensure exports directory
const ensureExportsDir = () => {
  const exportsDir = path.join(__dirname, '..', 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  return exportsDir;
};

// ✅ Status color mapping متطابق مع الـ Invoice Model
const getStatusColor = (status) => {
  const colors = {
    paid: 'D4EDDA', // green
    partially_paid: 'FFF3CD', // yellow
    overdue: 'F8D7DA', // red
    cancelled: 'E2E3E5', // gray
    draft: 'D1ECF1', // blue
    issued: 'D1ECF1', // blue
    refunded: 'E2E3E5', // gray
  };
  return colors[status] || 'FFFFFF';
};

// ============================================================
// Export Invoices to PDF
// ============================================================
exports.exportInvoicesToPDF = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.body;

  // ✅ Build filter اختياري
  const filter = {};
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new AppError('Invalid date format', 400));
    }
    filter.createdAt = { $gte: start, $lte: end };
  }

  // ✅ شيلنا .lean() عشان الـ virtuals تشتغل
  const invoices = await Invoice.find(filter)
    .populate({ path: 'customer', select: 'name email phone address' })
    .populate({ path: 'items.product', select: 'name productCode' });

  if (invoices.length === 0) {
    return next(new AppError('No invoices found for the selected period', 404));
  }

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const exportsDir = ensureExportsDir();
  const fileName = `invoices_report_${new Date().toISOString().split('T')[0]}.pdf`;
  const filePath = path.join(exportsDir, fileName);
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  // Title
  doc
    .fontSize(24)
    .font('Helvetica-Bold')
    .text('INVOICES REPORT', { align: 'center' });
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(`Generated on: ${new Date().toLocaleDateString()}`, {
      align: 'center',
    });
  doc.moveDown(2);

  invoices.forEach((invoice, index) => {
    if (index > 0) doc.addPage();

    // ✅ formattedInvoiceNumber من الـ virtual
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(`Invoice: ${invoice.formattedInvoiceNumber}`, { underline: true });
    doc.moveDown();

    // Customer Info
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Customer Information:', { underline: true });
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${invoice.customer?.name || 'N/A'}`);
    doc.text(`Email: ${invoice.customer?.email || 'N/A'}`);
    doc.text(`Phone: ${invoice.customer?.phone || 'N/A'}`);
    doc.text(`Address: ${invoice.customer?.address || 'N/A'}`);
    doc.moveDown();

    // Invoice Details
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Invoice Details:', { underline: true });
    doc.fontSize(10).font('Helvetica');
    doc.text(`Issue Date: ${new Date(invoice.issueDate).toLocaleDateString()}`);
    doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`);
    // ✅ متطابق مع الـ enum في الـ Model
    doc.text(
      `Status: ${invoice.status?.replace(/_/g, ' ').toUpperCase() || 'N/A'}`
    );
    doc.text(`Payment Terms: ${invoice.paymentTerms || 'N/A'}`);
    doc.moveDown();

    // Items
    if (invoice.items?.length > 0) {
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('Items:', { underline: true });
      doc.fontSize(10).font('Helvetica');
      invoice.items.forEach((item) => {
        doc.text(
          `- ${item.product?.name || 'Product'} (${item.product?.productCode || 'N/A'})`
        );
        doc.text(
          `  Qty: ${item.quantity} × 
$$
{item.unitPrice || 0} =
$$
{item.lineTotal || 0}`,
          { indent: 20 }
        );
      });
    }
    doc.moveDown();

    // Financial Summary
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Financial Summary:', { underline: true });
    doc.fontSize(10).font('Helvetica');
    doc.text(`Subtotal: 
$$
{invoice.subtotal?.toFixed(2) || '0.00'}`);
    doc.text(`Discount:
$$
{invoice.discountAmount?.toFixed(2) || '0.00'}`);
    doc.text(`Tax: 
$$
{invoice.taxAmount?.toFixed(2) || '0.00'}`);
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text(`Total Amount:
$$
{invoice.totalAmount?.toFixed(2) || '0.00'}`);
    doc.text(`Amount Paid: 
$$
{invoice.amountPaid?.toFixed(2) || '0.00'}`);
    doc.text(
      `Balance Due:
$$
{invoice.balanceDue?.toFixed(2) || '0.00'}`,
      { color: invoice.balanceDue > 0 ? 'red' : 'green' }
    );
  });

  doc.end();

  writeStream.on('finish', () => {
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading file:', err);
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting file:', unlinkErr);
      });
    });
  });
});

// ============================================================
// Export Invoices to Excel
// ============================================================
exports.exportInvoicesToExcel = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.body;

  // ✅ Build filter اختياري
  const filter = {};
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new AppError('Invalid date format', 400));
    }
    filter.createdAt = { $gte: start, $lte: end };
  }

  // ✅ شيلنا .lean() عشان الـ virtuals تشتغل
  const invoices = await Invoice.find(filter)
    .populate({ path: 'customer', select: 'name email phone address' })
    .populate({ path: 'items.product', select: 'name productCode' });

  if (invoices.length === 0) {
    return next(new AppError('No invoices found for the selected period', 404));
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Invoices Report');

  // Title
  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = 'INVOICES REPORT';
  sheet.getCell('A1').font = { bold: true, size: 18 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:J2');
  sheet.getCell('A2').value =
    `Generated on: ${new Date().toLocaleDateString()}`;
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  // Columns
  sheet.columns = [
    { header: 'Invoice Number', key: 'invoiceNumber', width: 20 },
    { header: 'Customer Name', key: 'customerName', width: 25 },
    { header: 'Customer Email', key: 'customerEmail', width: 25 },
    { header: 'Customer Phone', key: 'customerPhone', width: 20 },
    { header: 'Issue Date', key: 'issueDate', width: 15 },
    { header: 'Due Date', key: 'dueDate', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Total Amount', key: 'totalAmount', width: 15 },
    { header: 'Amount Paid', key: 'amountPaid', width: 15 },
    { header: 'Balance Due', key: 'balanceDue', width: 15 },
  ];

  // Header Row Style
  sheet.getRow(4).font = { bold: true, color: { argb: 'FFFFFF' } };
  sheet.getRow(4).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '0A0F4D' },
  };
  sheet.getRow(4).alignment = { horizontal: 'center' };

  // Data Rows
  invoices.forEach((invoice) => {
    const row = sheet.addRow({
      // ✅ formattedInvoiceNumber من الـ virtual
      invoiceNumber: invoice.formattedInvoiceNumber,
      customerName: invoice.customer?.name || 'N/A',
      customerEmail: invoice.customer?.email || 'N/A',
      customerPhone: invoice.customer?.phone || 'N/A',
      issueDate: new Date(invoice.issueDate).toLocaleDateString(),
      dueDate: new Date(invoice.dueDate).toLocaleDateString(),
      // ✅ replace كل الـ underscores
      status: invoice.status?.replace(/_/g, ' ').toUpperCase() || 'N/A',
      totalAmount: invoice.totalAmount || 0,
      amountPaid: invoice.amountPaid || 0,
      balanceDue: invoice.balanceDue || 0,
    });

    row.getCell('totalAmount').numFmt = '$#,##0.00';
    row.getCell('amountPaid').numFmt = '$#,##0.00';
    row.getCell('balanceDue').numFmt = '$#,##0.00';

    // ✅ Status colors متطابقة مع الـ Invoice Model
    const statusColor = getStatusColor(invoice.status);
    row.getCell('status').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: statusColor },
    };
  });

  // Borders
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber >= 4) {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    }
  });

  const exportsDir = ensureExportsDir();
  const fileName = `invoices_report_${new Date().toISOString().split('T')[0]}.xlsx`;
  const filePath = path.join(exportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);

  res.download(filePath, fileName, (err) => {
    if (err) console.error('Error downloading file:', err);
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) console.error('Error deleting file:', unlinkErr);
    });
  });
});

// ============================================================
// Customer Statement Excel
// ============================================================
exports.fileCustomerStatement = catchAsync(async (req, res, next) => {
  const { name } = req.body;
  if (!name) {
    return next(new AppError('Customer name is required', 400));
  }

  const customer = await Customer.findOne({ name })
    .populate({
      path: 'transactions',
      populate: [
        { path: 'items.product', select: 'name productCode' },
        { path: 'referenceId', select: 'formattedInvoiceNumber totalAmount' },
      ],
    })
    .lean();

  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  const transactions = customer.transactions || [];
  let totalDebit = 0;
  let totalCredit = 0;
  let runningBalance = 0;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Customer Statement');

  // Title
  worksheet.mergeCells('A1:H1');
  worksheet.getCell('A1').value = 'CUSTOMER ACCOUNT STATEMENT';
  worksheet.getCell('A1').font = { bold: true, size: 18 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  worksheet.mergeCells('A2:H2');
  worksheet.getCell('A2').value =
    `Generated on: ${new Date().toLocaleDateString()}`;
  worksheet.getCell('A2').alignment = { horizontal: 'center' };

  // Customer Info
  worksheet.getCell('A4').value = 'Customer Information';
  worksheet.getCell('A4').font = { bold: true, size: 14 };

  worksheet.getCell('A5').value = 'Name:';
  worksheet.getCell('B5').value = customer.name;
  worksheet.getCell('A6').value = 'Email:';
  worksheet.getCell('B6').value = customer.email || 'N/A';
  worksheet.getCell('A7').value = 'Phone:';
  worksheet.getCell('B7').value = customer.phone || 'N/A';
  worksheet.getCell('A8').value = 'Address:';
  worksheet.getCell('B8').value = customer.address || 'N/A';
  worksheet.getCell('A9').value = 'Outstanding Balance:';
  worksheet.getCell('B9').value = customer.outstandingBalance || 0;
  worksheet.getCell('B9').numFmt = '$#,##0.00';

  // Table Headers
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Invoice/Ref', key: 'reference', width: 20 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Items', key: 'items', width: 40 },
    { header: 'Debit', key: 'debit', width: 15 },
    { header: 'Credit', key: 'credit', width: 15 },
    { header: 'Balance', key: 'balance', width: 15 },
  ];

  const headerRow = 11;
  worksheet.getRow(headerRow).font = { bold: true, color: { argb: 'FFFFFF' } };
  worksheet.getRow(headerRow).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '0A0F4D' },
  };

  // Transaction Rows
  transactions.forEach((transaction) => {
    const debitAmount = transaction.status === 'debit' ? transaction.amount : 0;
    const creditAmount =
      transaction.status === 'credit' ? transaction.amount : 0;

    runningBalance += creditAmount - debitAmount;
    totalDebit += debitAmount;
    totalCredit += creditAmount;

    const itemsDetails = (transaction.items || [])
      .map(
        (item) =>
          `${item.product?.name || 'N/A'} (${item.product?.productCode || 'N/A'}) - Qty: ${item.quantity} @ 
$$
{item.price || 0}`
      )
      .join('\n');

    const row = worksheet.addRow({
      date: new Date(transaction.date).toLocaleDateString(),
      type:
        transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1),
      // ✅ formattedInvoiceNumber من الـ populate
      reference: transaction.referenceId?.formattedInvoiceNumber || 'N/A',
      description: transaction.details || 'N/A',
      items: itemsDetails || 'N/A',
      debit: debitAmount > 0 ? debitAmount : '',
      credit: creditAmount > 0 ? creditAmount : '',
      balance: runningBalance,
    });

    if (debitAmount > 0) {
      row.getCell('debit').numFmt = '$#,##0.00';
      row.getCell('debit').font = { color: { argb: 'DC3545' } };
    }
    if (creditAmount > 0) {
      row.getCell('credit').numFmt = '$#,##0.00';
      row.getCell('credit').font = { color: { argb: '28A745' } };
    }

    row.getCell('balance').numFmt = '$#,##0.00';
    row.getCell('balance').font = {
      color: { argb: runningBalance < 0 ? 'DC3545' : '28A745' },
    };

    if (itemsDetails.includes('\n')) {
      row.height = 15 * (itemsDetails.split('\n').length + 1);
    }

    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  });

  // Totals Row
  const totalsRow = worksheet.addRow({
    description: 'TOTALS',
    debit: totalDebit,
    credit: totalCredit,
    balance: runningBalance,
  });

  totalsRow.font = { bold: true };
  totalsRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'E0E0E0' },
  };
  totalsRow.getCell('debit').numFmt = '$#,##0.00';
  totalsRow.getCell('credit').numFmt = '$#,##0.00';
  totalsRow.getCell('balance').numFmt = '$#,##0.00';

  worksheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  const exportsDir = ensureExportsDir();
  // ✅ sanitize filename
  const safeName = sanitizeFileName(customer.name);
  const fileName = `${safeName}_Statement_${new Date().toISOString().split('T')[0]}.xlsx`;
  const filePath = path.join(exportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);

  res.download(filePath, fileName, (err) => {
    if (err) console.error('Error downloading file:', err);
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) console.error('Error deleting file:', unlinkErr);
    });
  });
});

// ============================================================
// Customer Statement PDF
// ============================================================
exports.fileCustomerStatementPDF = catchAsync(async (req, res, next) => {
  const { name } = req.body;
  if (!name) {
    return next(new AppError('Customer name is required', 400));
  }

  const customer = await Customer.findOne({ name })
    .populate({
      path: 'transactions',
      populate: [
        { path: 'items.product', select: 'name productCode' },
        { path: 'referenceId', select: 'formattedInvoiceNumber' },
      ],
    })
    .lean();

  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
  const exportsDir = ensureExportsDir();

  // ✅ sanitize filename
  const safeName = sanitizeFileName(customer.name);
  const fileName = `${safeName}_Statement_${new Date().toISOString().split('T')[0]}.pdf`;
  const filePath = path.join(exportsDir, fileName);
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  // Header
  doc
    .fontSize(20)
    .font('Helvetica-Bold')
    .text('CUSTOMER ACCOUNT STATEMENT', { align: 'center' });
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(`Generated on: ${new Date().toLocaleDateString()}`, {
      align: 'center',
    });
  doc.moveDown(2);

  // Customer Info
  doc.fontSize(14).font('Helvetica-Bold').text('Customer Information:');
  doc.fontSize(10).font('Helvetica');
  doc.text(`Name: ${customer.name}`);
  doc.text(`Email: ${customer.email || 'N/A'}`);
  doc.text(`Phone: ${customer.phone || 'N/A'}`);
  doc.text(`Address: ${customer.address || 'N/A'}`);
  doc.text(`Outstanding Balance:
$$
{(customer.outstandingBalance || 0).toFixed(2)}`);
  doc.moveDown();

  // Table
  doc.fontSize(12).font('Helvetica-Bold').text('Transaction Details:');
  doc.moveDown();

  let totalDebit = 0;
  let totalCredit = 0;
  let runningBalance = 0;

  const startX = 50;
  let currentY = doc.y;

  // Table Header
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Date', startX, currentY, { width: 80 });
  doc.text('Type', startX + 80, currentY, { width: 70 });
  doc.text('Invoice', startX + 150, currentY, { width: 80 });
  doc.text('Description', startX + 230, currentY, { width: 150 });
  doc.text('Debit', startX + 380, currentY, { width: 60 });
  doc.text('Credit', startX + 440, currentY, { width: 60 });
  doc.text('Balance', startX + 500, currentY, { width: 60 });

  doc.moveDown();
  doc
    .moveTo(startX, doc.y)
    .lineTo(startX + 560, doc.y)
    .stroke();
  doc.moveDown(0.5);

  // Transactions
  doc.fontSize(8).font('Helvetica');
  (customer.transactions || []).forEach((transaction) => {
    // ✅ تحقق من وجود صفحة كافية
    if (doc.y > 500) doc.addPage();

    const debitAmount = transaction.status === 'debit' ? transaction.amount : 0;
    const creditAmount =
      transaction.status === 'credit' ? transaction.amount : 0;

    runningBalance += creditAmount - debitAmount;
    totalDebit += debitAmount;
    totalCredit += creditAmount;

    currentY = doc.y;

    doc.fillColor('black');
    doc.text(
      new Date(transaction.date).toLocaleDateString(),
      startX,
      currentY,
      { width: 80 }
    );
    doc.text(transaction.type, startX + 80, currentY, { width: 70 });
    doc.text(
      transaction.referenceId?.formattedInvoiceNumber || 'N/A',
      startX + 150,
      currentY,
      { width: 80 }
    );
    doc.text(transaction.details || 'N/A', startX + 230, currentY, {
      width: 150,
    });

    if (debitAmount > 0) {
      doc.fillColor('red').text(
        `
$$
{debitAmount.toFixed(2)}`,
        startX + 380,
        currentY,
        { width: 60 }
      );
    } else {
      doc.fillColor('black').text('-', startX + 380, currentY, { width: 60 });
    }

    if (creditAmount > 0) {
      doc.fillColor('green').text(
        `
$$
{creditAmount.toFixed(2)}`,
        startX + 440,
        currentY,
        { width: 60 }
      );
    } else {
      doc.fillColor('black').text('-', startX + 440, currentY, { width: 60 });
    }

    doc.fillColor(runningBalance >= 0 ? 'green' : 'red').text(
      `
$$
{runningBalance.toFixed(2)}`,
      startX + 500,
      currentY,
      { width: 60 }
    );

    doc.fillColor('black');
    doc.moveDown();
  });

  // Totals
  doc
    .moveTo(startX, doc.y)
    .lineTo(startX + 560, doc.y)
    .stroke();
  doc.moveDown(0.5);

  currentY = doc.y;
  doc.font('Helvetica-Bold');
  doc.text('TOTALS', startX + 230, currentY, { width: 150 });
  doc.fillColor('red').text(
    `
$$
{totalDebit.toFixed(2)}`,
    startX + 380,
    currentY,
    { width: 60 }
  );
  doc.fillColor('green').text(
    `
$$
{totalCredit.toFixed(2)}`,
    startX + 440,
    currentY,
    { width: 60 }
  );
  doc.fillColor(runningBalance >= 0 ? 'green' : 'red').text(
    `
$$
{runningBalance.toFixed(2)}`,
    startX + 500,
    currentY,
    { width: 60 }
  );

  doc.end();

  writeStream.on('finish', () => {
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading file:', err);
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting file:', unlinkErr);
      });
    });
  });
});
