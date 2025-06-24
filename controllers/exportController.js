const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Invoice = require('../models/invoice');
const Customer = require('../models/customer');

// تحسين دالة تصدير الفواتير إلى PDF
exports.exportInvoicesToPDF = async (req, res) => {
  try {
    // جلب الفواتير مع populate كامل
    const invoices = await Invoice.find()
      .populate({
        path: 'customer',
        select: 'name email phone address',
      })
      .populate({
        path: 'items.product',
        select: 'name productCode price',
      })
      .lean();

    // إنشاء ملف PDF
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
    });

    // التأكد من وجود مجلد exports
    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const fileName = `invoices_report_${new Date().toISOString().split('T')[0]}.pdf`;
    const filePath = path.join(exportsDir, fileName);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // إضافة العنوان الرئيسي
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

    // إضافة معلومات الفواتير
    invoices.forEach((invoice, index) => {
      // إضافة فاصل بين الفواتير
      if (index > 0) {
        doc.addPage();
      }

      // رأس الفاتورة
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .text(
          `Invoice: ${invoice.formattedInvoiceNumber || `INV-${invoice.invoiceNumber}`}`,
          { underline: true }
        );

      doc.moveDown();

      // معلومات العميل
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

      // معلومات الفاتورة
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('Invoice Details:', { underline: true });
      doc.fontSize(10).font('Helvetica');
      doc.text(
        `Issue Date: ${new Date(invoice.issueDate).toLocaleDateString()}`
      );
      doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`);
      doc.text(
        `Status: ${invoice.status?.replace('_', ' ').toUpperCase() || 'N/A'}`
      );
      doc.text(`Payment Terms: ${invoice.paymentTerms || 'N/A'}`);

      doc.moveDown();

      // المنتجات
      if (invoice.items && invoice.items.length > 0) {
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
            `  Quantity: ${item.quantity} × $${item.unitPrice || 0} = $${item.lineTotal || 0}`,
            { indent: 20 }
          );
        });
      }

      doc.moveDown();

      // الملخص المالي
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('Financial Summary:', { underline: true });
      doc.fontSize(10).font('Helvetica');
      doc.text(`Subtotal: $${invoice.subtotal?.toFixed(2) || '0.00'}`);
      doc.text(`Discount: $${invoice.discountAmount?.toFixed(2) || '0.00'}`);
      doc.text(`Tax: $${invoice.taxAmount?.toFixed(2) || '0.00'}`);
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text(`Total Amount: $${invoice.totalAmount?.toFixed(2) || '0.00'}`);
      doc.text(`Amount Paid: $${invoice.amountPaid?.toFixed(2) || '0.00'}`);
      doc.text(`Balance Due: $${invoice.balanceDue?.toFixed(2) || '0.00'}`, {
        color: invoice.balanceDue > 0 ? 'red' : 'green',
      });
    });

    doc.end();

    writeStream.on('finish', () => {
      res.download(filePath, fileName, (err) => {
        if (err) console.error('Error downloading file:', err);
        // حذف الملف بعد التحميل
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting file:', unlinkErr);
        });
      });
    });
  } catch (err) {
    console.error('Error exporting invoices to PDF:', err);
    res
      .status(500)
      .json({
        message: 'Failed to export invoices to PDF',
        error: err.message,
      });
  }
};

// تحسين دالة تصدير الفواتير إلى Excel
exports.exportInvoicesToExcel = async (req, res) => {
  try {
    // جلب الفواتير مع populate كامل
    const invoices = await Invoice.find()
      .populate({
        path: 'customer',
        select: 'name email phone address',
      })
      .populate({
        path: 'items.product',
        select: 'name productCode price',
      })
      .lean();

    // إنشاء ملف Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Invoices Report');

    // إضافة معلومات الشركة
    sheet.mergeCells('A1:J1');
    sheet.getCell('A1').value = 'INVOICES REPORT';
    sheet.getCell('A1').font = { bold: true, size: 18 };
    sheet.getCell('A1').alignment = { horizontal: 'center' };

    sheet.mergeCells('A2:J2');
    sheet.getCell('A2').value =
      `Generated on: ${new Date().toLocaleDateString()}`;
    sheet.getCell('A2').alignment = { horizontal: 'center' };

    // إضافة الأعمدة
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

    // تنسيق رأس الجدول
    sheet.getRow(4).font = { bold: true, color: { argb: 'FFFFFF' } };
    sheet.getRow(4).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '0A0F4D' },
    };
    sheet.getRow(4).alignment = { horizontal: 'center' };

    // إضافة البيانات
    invoices.forEach((invoice) => {
      const row = sheet.addRow({
        invoiceNumber:
          invoice.formattedInvoiceNumber || `INV-${invoice.invoiceNumber}`,
        customerName: invoice.customer?.name || 'N/A',
        customerEmail: invoice.customer?.email || 'N/A',
        customerPhone: invoice.customer?.phone || 'N/A',
        issueDate: new Date(invoice.issueDate).toLocaleDateString(),
        dueDate: new Date(invoice.dueDate).toLocaleDateString(),
        status: invoice.status?.replace('_', ' ').toUpperCase() || 'N/A',
        totalAmount: invoice.totalAmount || 0,
        amountPaid: invoice.amountPaid || 0,
        balanceDue: invoice.balanceDue || 0,
      });

      // تنسيق الأرقام
      row.getCell('totalAmount').numFmt = '$#,##0.00';
      row.getCell('amountPaid').numFmt = '$#,##0.00';
      row.getCell('balanceDue').numFmt = '$#,##0.00';

      // تلوين حسب الحالة
      if (invoice.status === 'paid') {
        row.getCell('status').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'D4EDDA' },
        };
      } else if (invoice.status === 'unpaid') {
        row.getCell('status').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F8D7DA' },
        };
      }
    });

    // إضافة حدود للجدول
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

    // التأكد من وجود مجلد exports
    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const fileName = `invoices_report_${new Date().toISOString().split('T')[0]}.xlsx`;
    const filePath = path.join(exportsDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading file:', err);
      // حذف الملف بعد التحميل
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting file:', unlinkErr);
      });
    });
  } catch (err) {
    console.error('Error exporting invoices to Excel:', err);
    res
      .status(500)
      .json({
        message: 'Failed to export invoices to Excel',
        error: err.message,
      });
  }
};

// تحسين دالة كشف حساب العميل
exports.fileCustomerStatement = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Customer name is required' });
    }

    // جلب بيانات العميل مع populate كامل
    const customer = await Customer.findOne({ name })
      .populate({
        path: 'transactions',
        populate: [
          {
            path: 'items.product',
            select: 'name productCode price',
          },
          {
            path: 'referenceId',
            select: 'formattedInvoiceNumber totalAmount',
          },
        ],
      })
      .lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const transactions = customer.transactions || [];
    let totalDebit = 0;
    let totalCredit = 0;
    let runningBalance = 0;

    // إنشاء ملف Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Customer Statement');

    // رأس الملف
    worksheet.mergeCells('A1:H1');
    worksheet.getCell('A1').value = 'CUSTOMER ACCOUNT STATEMENT';
    worksheet.getCell('A1').font = { bold: true, size: 18 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:H2');
    worksheet.getCell('A2').value =
      `Generated on: ${new Date().toLocaleDateString()}`;
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    // معلومات العميل
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

    // أعمدة الجدول
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

    // تنسيق رأس الجدول
    const headerRow = 10;
    worksheet.getRow(headerRow).font = {
      bold: true,
      color: { argb: 'FFFFFF' },
    };
    worksheet.getRow(headerRow).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '0A0F4D' },
    };

    // إضافة المعاملات
    let currentRow = headerRow + 1;
    transactions.forEach((transaction) => {
      const debitAmount =
        transaction.status === 'debit' ? transaction.amount : 0;
      const creditAmount =
        transaction.status === 'credit' ? transaction.amount : 0;

      runningBalance += creditAmount - debitAmount;
      totalDebit += debitAmount;
      totalCredit += creditAmount;

      // تكملة دالة fileCustomerStatement

      // تجهيز تفاصيل المنتجات
      let itemsDetails = '';
      if (transaction.items && transaction.items.length > 0) {
        itemsDetails = transaction.items
          .map(
            (item) =>
              `${item.product?.name || 'Product'} (${item.product?.productCode || 'N/A'}) - Qty: ${item.quantity} @ $${item.price || item.product?.price || 0}`
          )
          .join('\n');
      }

      // إضافة صف المعاملة
      const row = worksheet.addRow({
        date: new Date(transaction.date).toLocaleDateString(),
        type:
          transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1),
        reference: transaction.referenceId?.formattedInvoiceNumber || 'N/A',
        description: transaction.details || 'N/A',
        items: itemsDetails || 'N/A',
        debit: debitAmount > 0 ? debitAmount : '',
        credit: creditAmount > 0 ? creditAmount : '',
        balance: runningBalance,
      });

      // تنسيق الأرقام
      if (debitAmount > 0) {
        row.getCell('debit').numFmt = '$#,##0.00';
        row.getCell('debit').font = { color: { argb: 'DC3545' } };
      }
      if (creditAmount > 0) {
        row.getCell('credit').numFmt = '$#,##0.00';
        row.getCell('credit').font = { color: { argb: '28A745' } };
      }
      row.getCell('balance').numFmt = '$#,##0.00';

      // تلوين الرصيد حسب القيمة
      if (runningBalance < 0) {
        row.getCell('balance').font = { color: { argb: 'DC3545' } };
      } else {
        row.getCell('balance').font = { color: { argb: '28A745' } };
      }

      // ضبط ارتفاع الصف إذا كان هناك منتجات متعددة
      if (itemsDetails.includes('\n')) {
        row.height = 15 * (itemsDetails.split('\n').length + 1);
      }

      // إضافة حدود
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.alignment = { vertical: 'top', wrapText: true };
      });

      currentRow++;
    });

    // إضافة صف فارغ
    currentRow++;

    // إضافة الإجماليات
    const totalsRow = worksheet.addRow({
      date: '',
      type: '',
      reference: '',
      description: 'TOTALS',
      items: '',
      debit: totalDebit,
      credit: totalCredit,
      balance: runningBalance,
    });

    // تنسيق صف الإجماليات
    totalsRow.font = { bold: true };
    totalsRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'E0E0E0' },
    };

    totalsRow.getCell('debit').numFmt = '$#,##0.00';
    totalsRow.getCell('credit').numFmt = '$#,##0.00';
    totalsRow.getCell('balance').numFmt = '$#,##0.00';

    totalsRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'double' },
        bottom: { style: 'double' },
      };
    });

    // إضافة ملخص الحساب
    currentRow += 2;
    worksheet.getCell(`A${currentRow}`).value = 'ACCOUNT SUMMARY';
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 12 };

    currentRow++;
    worksheet.getCell(`A${currentRow}`).value = 'Total Transactions:';
    worksheet.getCell(`B${currentRow}`).value = transactions.length;

    currentRow++;
    worksheet.getCell(`A${currentRow}`).value = 'Total Debits:';
    worksheet.getCell(`B${currentRow}`).value = totalDebit;
    worksheet.getCell(`B${currentRow}`).numFmt = '$#,##0.00';
    worksheet.getCell(`B${currentRow}`).font = { color: { argb: 'DC3545' } };

    currentRow++;
    worksheet.getCell(`A${currentRow}`).value = 'Total Credits:';
    worksheet.getCell(`B${currentRow}`).value = totalCredit;
    worksheet.getCell(`B${currentRow}`).numFmt = '$#,##0.00';
    worksheet.getCell(`B${currentRow}`).font = { color: { argb: '28A745' } };

    currentRow++;
    worksheet.getCell(`A${currentRow}`).value = 'Current Balance:';
    worksheet.getCell(`B${currentRow}`).value = runningBalance;
    worksheet.getCell(`B${currentRow}`).numFmt = '$#,##0.00';
    worksheet.getCell(`B${currentRow}`).font = {
      bold: true,
      color: { argb: runningBalance >= 0 ? '28A745' : 'DC3545' },
    };

    // إضافة ملاحظة في النهاية
    currentRow += 2;
    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value =
      'Note: This statement is computer generated and does not require signature.';
    worksheet.getCell(`A${currentRow}`).font = { italic: true, size: 10 };
    worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };

    // ضبط عرض الأعمدة للطباعة
    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };

    // التأكد من وجود مجلد exports
    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const fileName = `${customer.name.replace(/\s+/g, '_')}_Statement_${new Date().toISOString().split('T')[0]}.xlsx`;
    const filePath = path.join(exportsDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading file:', err);
      // حذف الملف بعد التحميل
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting file:', unlinkErr);
      });
    });
  } catch (error) {
    console.error('Error generating customer statement:', error);
    res
      .status(500)
      .json({
        message: 'Error generating customer statement',
        error: error.message,
      });
  }
};

// دالة إضافية لتصدير كشف حساب العميل كـ PDF
exports.fileCustomerStatementPDF = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Customer name is required' });
    }

    // جلب بيانات العميل مع populate كامل
    const customer = await Customer.findOne({ name })
      .populate({
        path: 'transactions',
        populate: [
          {
            path: 'items.product',
            select: 'name productCode price',
          },
          {
            path: 'referenceId',
            select: 'formattedInvoiceNumber',
          },
        ],
      })
      .lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // إنشاء ملف PDF
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      layout: 'landscape',
    });

    // التأكد من وجود مجلد exports
    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const fileName = `${customer.name.replace(/\s+/g, '_')}_Statement_${new Date().toISOString().split('T')[0]}.pdf`;
    const filePath = path.join(exportsDir, fileName);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // رأس الملف
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

    // معلومات العميل
    doc.fontSize(14).font('Helvetica-Bold').text('Customer Information:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${customer.name}`);
    doc.text(`Email: ${customer.email || 'N/A'}`);
    doc.text(`Phone: ${customer.phone || 'N/A'}`);
    doc.text(`Address: ${customer.address || 'N/A'}`);

    doc.moveDown();

    // رسم الجدول يدوياً
    doc.fontSize(12).font('Helvetica-Bold').text('Transaction Details:');
    doc.moveDown();

    let totalDebit = 0;
    let totalCredit = 0;
    let runningBalance = 0;

    // رأس الجدول
    const startX = 50;
    let currentY = doc.y;

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Date', startX, currentY, { width: 80 });
    doc.text('Type', startX + 80, currentY, { width: 60 });
    doc.text('Invoice', startX + 140, currentY, { width: 80 });
    doc.text('Description', startX + 220, currentY, { width: 150 });
    doc.text('Debit', startX + 370, currentY, { width: 60 });
    doc.text('Credit', startX + 430, currentY, { width: 60 });
    doc.text('Balance', startX + 490, currentY, { width: 60 });

    doc.moveDown();
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + 550, doc.y)
      .stroke();
    doc.moveDown(0.5);

    // بيانات المعاملات
    doc.fontSize(8).font('Helvetica');
    customer.transactions.forEach((transaction) => {
      const debitAmount =
        transaction.status === 'debit' ? transaction.amount : 0;
      const creditAmount =
        transaction.status === 'credit' ? transaction.amount : 0;

      runningBalance += creditAmount - debitAmount;
      totalDebit += debitAmount;
      totalCredit += creditAmount;

      currentY = doc.y;

      doc.text(
        new Date(transaction.date).toLocaleDateString(),
        startX,
        currentY,
        { width: 80 }
      );
      doc.text(transaction.type, startX + 80, currentY, { width: 60 });
      doc.text(
        transaction.referenceId?.formattedInvoiceNumber || 'N/A',
        startX + 140,
        currentY,
        { width: 80 }
      );
      doc.text(transaction.details || 'N/A', startX + 220, currentY, {
        width: 150,
      });

      if (debitAmount > 0) {
        doc
          .fillColor('red')
          .text(`$${debitAmount.toFixed(2)}`, startX + 370, currentY, {
            width: 60,
          });
      } else {
        doc.text('-', startX + 370, currentY, { width: 60 });
      }

      if (creditAmount > 0) {
        doc
          .fillColor('green')
          .text(`$${creditAmount.toFixed(2)}`, startX + 430, currentY, {
            width: 60,
          });
      } else {
        doc.text('-', startX + 430, currentY, { width: 60 });
      }

      doc
        .fillColor(runningBalance >= 0 ? 'green' : 'red')
        .text(`$${runningBalance.toFixed(2)}`, startX + 490, currentY, {
          width: 60,
        });

      doc.fillColor('black');
      doc.moveDown();
    });

    // خط الإجماليات
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + 550, doc.y)
      .stroke();
    doc.moveDown(0.5);

    // الإجماليات
    currentY = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('TOTALS', startX + 220, currentY, { width: 150 });
    doc
      .fillColor('red')
      .text(`$${totalDebit.toFixed(2)}`, startX + 370, currentY, { width: 60 });
    doc
      .fillColor('green')
      .text(`$${totalCredit.toFixed(2)}`, startX + 430, currentY, {
        width: 60,
      });
    doc
      .fillColor(runningBalance >= 0 ? 'green' : 'red')
      .text(`$${runningBalance.toFixed(2)}`, startX + 490, currentY, {
        width: 60,
      });

    doc.end();

    writeStream.on('finish', () => {
      res.download(filePath, fileName, (err) => {
        if (err) console.error('Error downloading file:', err);
        // حذف الملف بعد التحميل
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting file:', unlinkErr);
        });
      });
    });
  } catch (error) {
    console.error('Error generating PDF statement:', error);
    res
      .status(500)
      .json({
        message: 'Error generating PDF statement',
        error: error.message,
      });
  }
};
