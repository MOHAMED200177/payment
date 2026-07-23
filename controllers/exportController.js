'use strict';
const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');
const ExcelJS     = require('exceljs');
const Invoice     = require('../models/invoice');
const Payment     = require('../models/payment');
const Return      = require('../models/return');
const Customer    = require('../models/customer');
const AppError    = require('../utils/appError');
const catchAsync  = require('../utils/catchAsync');

// ── Helpers ──────────────────────────────────────────────────
const sanitizeFileName = (name) => name.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').replace(/\s+/g, '_').substring(0, 50);
const ensureExportsDir = () => {
  const dir = path.join(__dirname, '..', 'exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtNum  = (n) => (n || 0).toFixed(2);
const getStatusColor = (status) => ({ paid: 'D4EDDA', partially_paid: 'FFF3CD', overdue: 'F8D7DA', cancelled: 'E2E3E5', draft: 'D1ECF1', issued: 'D1ECF1', refunded: 'E2E3E5' }[status] || 'FFFFFF');

// ── Build statement data (shared between Excel and PDF) ──────
async function buildStatementData({ name, startDate, endDate, companyId }) {
  const customer = await Customer.findOne({ name, company: companyId }).lean();
  if (!customer) return null;

  const customerId = customer._id;
  const buildDateRange = (start, end) => {
    const dr = {};
    if (start) dr.$gte = new Date(start);
    if (end)   { const e = new Date(end); e.setHours(23, 59, 59, 999); dr.$lte = e; }
    return Object.keys(dr).length ? dr : null;
  };
  const dr = buildDateRange(startDate, endDate);

  const invoiceMatch = { customer: customerId, company: companyId, isDeleted: { $ne: true } };
  if (dr) invoiceMatch.issueDate = dr;
  const paymentMatch = { customer: customerId, company: companyId };
  if (dr) paymentMatch.date = dr;
  const returnMatch  = { customer: customerId, company: companyId, isDeleted: { $ne: true }, status: { $ne: 'cancelled' } };
  if (dr) returnMatch.date = dr;

  const [invoices, payments, returns] = await Promise.all([
    Invoice.find(invoiceMatch)
      .populate({ path: 'items.product', select: 'name productCode unit' })
      .select('invoiceNumber issueDate dueDate totalAmount subtotal discountAmount taxAmount amountPaid balanceDue status items notes')
      .sort('issueDate').lean(),
    Payment.find(paymentMatch)
      .populate({ path: 'invoice', select: 'invoiceNumber' })
      .select('amount method date status invoice notes').sort('date').lean(),
    Return.find(returnMatch)
      .populate({ path: 'product', select: 'name productCode unit' })
      .populate({ path: 'invoice', select: 'invoiceNumber' })
      .select('refundAmount date invoice product quantity reason status').sort('date').lean(),
  ]);

  // Opening balance
  let openingBalance = 0;
  if (dr && dr.$gte) {
    const b = { customer: customerId, company: companyId };
    const [pi, pp, pr] = await Promise.all([
      Invoice.find({ ...b, issueDate: { $lt: dr.$gte }, isDeleted: { $ne: true } }).select('totalAmount').lean(),
      Payment.find({ ...b, date: { $lt: dr.$gte }, status: { $ne: 'Failed' } }).select('amount').lean(),
      Return.find({ ...b, date: { $lt: dr.$gte }, isDeleted: { $ne: true }, status: { $ne: 'cancelled' } }).select('refundAmount').lean(),
    ]);
    openingBalance = +(pi.reduce((s, i) => s + i.totalAmount, 0) - pp.reduce((s, p) => s + p.amount, 0) - pr.reduce((s, r) => s + r.refundAmount, 0)).toFixed(2);
  }

  // Build entries
  const entries = [];
  invoices.forEach((inv) => {
    const invRef = `INV-${String(inv.invoiceNumber).padStart(6, '0')}`;
    entries.push({
      date: inv.issueDate,
      type: 'Sales Invoice',
      typeKey: 'invoice',
      reference: invRef,
      description: `Sales Invoice — ${invRef}${inv.notes ? ` (${inv.notes})` : ''}`,
      invoiceNumber: invRef,
      paymentRef: '—',
      debit: inv.totalAmount,
      credit: 0,
      status: inv.status,
      subtotal: inv.subtotal || 0,
      discountAmount: inv.discountAmount || 0,
      taxAmount: inv.taxAmount || 0,
      items: (inv.items || []).map((it) => ({
        productName: it.product?.name || 'Unknown',
        productCode: it.product?.productCode || '',
        unit: it.product?.unit || '',
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
      })),
    });
  });
  payments.forEach((pay) => {
    if (pay.status === 'Failed') return;
    const payRef = `PAY-${String(pay._id).slice(-8).toUpperCase()}`;
    const invRef = pay.invoice ? `INV-${String(pay.invoice.invoiceNumber).padStart(6, '0')}` : '—';
    entries.push({
      date: pay.date,
      type: 'Payment Received',
      typeKey: 'payment',
      reference: payRef,
      description: `Payment via ${pay.method || 'Cash'}${invRef !== '—' ? ` for ${invRef}` : ''}`,
      invoiceNumber: invRef,
      paymentRef: payRef,
      debit: 0,
      credit: pay.amount,
      status: pay.status,
      items: [],
    });
  });
  returns.forEach((ret) => {
    const retRef = `RET-${String(ret._id).slice(-8).toUpperCase()}`;
    const invRef = ret.invoice ? `INV-${String(ret.invoice.invoiceNumber).padStart(6, '0')}` : '—';
    const productName = ret.product?.name || 'Unknown';
    entries.push({
      date: ret.date,
      type: 'Sales Return',
      typeKey: 'return',
      reference: retRef,
      description: `Return — ${productName} (Qty: ${ret.quantity})${invRef !== '—' ? ` from ${invRef}` : ''}${ret.reason ? ` — ${ret.reason}` : ''}`,
      invoiceNumber: invRef,
      paymentRef: '—',
      debit: 0,
      credit: ret.refundAmount,
      status: ret.status,
      items: [{
        productName,
        productCode: ret.product?.productCode || '',
        unit: ret.product?.unit || '',
        quantity: ret.quantity,
        unitPrice: ret.quantity > 0 ? +(ret.refundAmount / ret.quantity).toFixed(2) : 0,
        lineTotal: ret.refundAmount,
      }],
    });
  });

  // Sort chronologically
  const typeOrder = { invoice: 1, payment: 2, return: 3 };
  entries.sort((a, b) => {
    const diff = new Date(a.date) - new Date(b.date);
    return diff !== 0 ? diff : (typeOrder[a.typeKey] || 9) - (typeOrder[b.typeKey] || 9);
  });

  // Running balance
  let running = openingBalance;
  entries.forEach((e) => {
    running += e.debit - e.credit;
    e.balance = +running.toFixed(2);
    e.debit   = +e.debit.toFixed(2);
    e.credit  = +e.credit.toFixed(2);
  });

  const totalDebit    = +entries.reduce((s, e) => s + e.debit, 0).toFixed(2);
  const totalCredit   = +entries.reduce((s, e) => s + e.credit, 0).toFixed(2);
  const closingBalance = +(openingBalance + totalDebit - totalCredit).toFixed(2);

  return {
    customer,
    entries,
    summary: { openingBalance, totalDebit, totalCredit, closingBalance, outstandingBalance: +(customer.outstandingBalance || 0).toFixed(2) },
    period: { startDate: dr?.$gte || null, endDate: dr?.$lte || null },
  };
}

// ============================================================
// Customer Statement — Excel Export (Professional Accounting)
// ============================================================
exports.fileCustomerStatement = catchAsync(async (req, res, next) => {
  const { name, startDate, endDate } = req.body;
  if (!name) return next(new AppError('Customer name is required', 400));

  const data = await buildStatementData({ name, startDate, endDate, companyId: req.companyId });
  if (!data) return next(new AppError('Customer not found', 404));

  const { customer, entries, summary, period } = data;

  const workbook  = new ExcelJS.Workbook();
  workbook.creator = 'ERP System';
  workbook.created = new Date();
  const ws = workbook.addWorksheet('Customer Statement', { pageSetup: { fitToPage: true, orientation: 'landscape' } });

  // ── Styles ────────────────────────────────────────────────
  const NAVY   = '0A0F4D';
  const WHITE  = 'FFFFFFFF';
  const GREEN  = 'FF28A745';
  const RED    = 'FFDC3545';
  const AMBER  = 'FFFFC107';
  const LGRAY  = 'FFF5F5F5';
  const DKGRAY = 'FF6C757D';

  const hStyle = (bg, color = WHITE, size = 11) => ({
    font: { bold: true, color: { argb: color }, size },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  });
  const cellStyle = (fmt, color, bold = false) => ({
    font: { color: { argb: color || 'FF000000' }, bold, size: 10 },
    numFmt: fmt,
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } },
  });

  // ── Column Widths ─────────────────────────────────────────
  ws.columns = [
    { key: 'date',        width: 14  },  // A
    { key: 'type',        width: 18  },  // B
    { key: 'reference',   width: 16  },  // C
    { key: 'description', width: 38  },  // D
    { key: 'invNum',      width: 14  },  // E
    { key: 'payRef',      width: 18  },  // F
    { key: 'product',     width: 22  },  // G
    { key: 'code',        width: 12  },  // H
    { key: 'qty',         width: 8   },  // I
    { key: 'unitPrice',   width: 13  },  // J
    { key: 'lineTotal',   width: 13  },  // K
    { key: 'debit',       width: 15  },  // L
    { key: 'credit',      width: 15  },  // M
    { key: 'balance',     width: 15  },  // N
  ];

  // ── Row 1 — Company Header ─────────────────────────────────
  ws.mergeCells('A1:N1');
  const title = ws.getCell('A1');
  title.value = 'CUSTOMER ACCOUNT STATEMENT';
  title.font  = { bold: true, size: 16, color: { argb: WHITE } };
  title.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 36;

  // ── Row 2 — Generated date ────────────────────────────────
  ws.mergeCells('A2:N2');
  const genCell = ws.getCell('A2');
  genCell.value     = `Generated on: ${fmtDate(new Date())}`;
  genCell.font      = { italic: true, size: 10, color: { argb: DKGRAY } };
  genCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 18;

  // ── Row 3 — blank ─────────────────────────────────────────
  ws.getRow(3).height = 6;

  // ── Rows 4-8 — Customer Info ──────────────────────────────
  const infoStyles = { font: { size: 10 }, alignment: { vertical: 'middle' } };
  const labelStyle = { font: { bold: true, size: 10, color: { argb: NAVY } }, alignment: { vertical: 'middle' } };

  const infoData = [
    ['Customer Name:', customer.name,  'Statement Period:', period.startDate ? `${fmtDate(period.startDate)} — ${fmtDate(period.endDate)}` : 'All Dates'],
    ['Email:',        customer.email || '—', 'Phone:', customer.phone || '—'],
    ['Address:',      customer.address || '—', '', ''],
  ];

  infoData.forEach((row, i) => {
    const r = ws.getRow(4 + i);
    r.height = 18;
    ws.mergeCells(`A${4+i}:B${4+i}`);
    ws.mergeCells(`C${4+i}:G${4+i}`);
    ws.mergeCells(`H${4+i}:I${4+i}`);
    ws.mergeCells(`J${4+i}:N${4+i}`);
    const [lbl1, val1, lbl2, val2] = row;
    ws.getCell(`A${4+i}`).value = lbl1; Object.assign(ws.getCell(`A${4+i}`), labelStyle);
    ws.getCell(`C${4+i}`).value = val1; Object.assign(ws.getCell(`C${4+i}`), infoStyles);
    ws.getCell(`H${4+i}`).value = lbl2; Object.assign(ws.getCell(`H${4+i}`), labelStyle);
    ws.getCell(`J${4+i}`).value = val2; Object.assign(ws.getCell(`J${4+i}`), infoStyles);
  });

  // ── Row 8 — blank ─────────────────────────────────────────
  ws.getRow(8).height = 6;

  // ── Row 9 — Table Header ──────────────────────────────────
  const HDR_ROW = 9;
  ws.getRow(HDR_ROW).height = 24;
  const headers = ['Date', 'Trans. Type', 'Reference', 'Description', 'Invoice #', 'Payment Ref', 'Product', 'Code', 'Qty', 'Unit Price', 'Line Total', 'Debit', 'Credit', 'Running Balance'];
  headers.forEach((h, idx) => {
    const cell = ws.getCell(HDR_ROW, idx + 1);
    cell.value = h;
    Object.assign(cell, hStyle(NAVY));
  });

  // ── Data Rows ─────────────────────────────────────────────
  let currentRow = HDR_ROW + 1;

  entries.forEach((entry) => {
    const isEven = (currentRow - HDR_ROW) % 2 === 0;
    const rowBg = isEven ? LGRAY : 'FFFFFFFF';

    if (entry.items && entry.items.length > 0) {
      entry.items.forEach((item, itemIdx) => {
        const r = ws.getRow(currentRow);
        r.height = 16;

        const setCell = (col, val, fmt, fg, bold) => {
          const c = ws.getCell(currentRow, col);
          c.value = val;
          c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          if (fmt)  c.numFmt = fmt;
          c.font  = { size: 10, color: { argb: fg || 'FF000000' }, bold: !!bold };
          c.alignment = { vertical: 'middle', horizontal: col >= 9 ? 'right' : 'left' };
          c.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } };
        };

        if (itemIdx === 0) {
          setCell(1, fmtDate(entry.date));
          setCell(2, entry.type);
          setCell(3, entry.reference, null, NAVY);
          setCell(4, entry.description);
          setCell(5, entry.invoiceNumber || '—');
          setCell(6, entry.paymentRef || '—');
          setCell(12, entry.debit  > 0 ? entry.debit  : null, '#,##0.00', RED);
          setCell(13, entry.credit > 0 ? entry.credit : null, '#,##0.00', GREEN);
          setCell(14, entry.balance, '#,##0.00', entry.balance > 0 ? RED : GREEN, true);
        } else {
          [1,2,3,4,5,6,12,13,14].forEach(c => {
            const cell = ws.getCell(currentRow, c);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          });
        }

        setCell(7, item.productName);
        setCell(8, item.productCode);
        setCell(9, item.quantity,  '0', null, false);
        setCell(10, item.unitPrice, '#,##0.00');
        setCell(11, item.lineTotal, '#,##0.00');

        currentRow++;
      });
    } else {
      const r = ws.getRow(currentRow);
      r.height = 16;
      const setCell = (col, val, fmt, fg, bold) => {
        const c = ws.getCell(currentRow, col);
        c.value = val;
        c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        if (fmt)  c.numFmt = fmt;
        c.font  = { size: 10, color: { argb: fg || 'FF000000' }, bold: !!bold };
        c.alignment = { vertical: 'middle', horizontal: col >= 9 ? 'right' : 'left' };
        c.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } };
      };
      setCell(1, fmtDate(entry.date));
      setCell(2, entry.type);
      setCell(3, entry.reference, null, NAVY);
      setCell(4, entry.description);
      setCell(5, entry.invoiceNumber || '—');
      setCell(6, entry.paymentRef || '—');
      setCell(7, ''); setCell(8, ''); setCell(9, null); setCell(10, null); setCell(11, null);
      setCell(12, entry.debit  > 0 ? entry.debit  : null, '#,##0.00', RED);
      setCell(13, entry.credit > 0 ? entry.credit : null, '#,##0.00', GREEN);
      setCell(14, entry.balance, '#,##0.00', entry.balance > 0 ? RED : GREEN, true);
      currentRow++;
    }
  });

  // ── Totals Row ────────────────────────────────────────────
  ws.getRow(currentRow).height = 22;
  const totRow = currentRow;
  ws.mergeCells(`A${totRow}:K${totRow}`);
  const totLabel = ws.getCell(`A${totRow}`);
  totLabel.value = 'PERIOD TOTALS';
  Object.assign(totLabel, hStyle(NAVY));

  ['L', 'M', 'N'].forEach((col, i) => {
    const vals = [summary.totalDebit, summary.totalCredit, summary.closingBalance];
    const colors = [RED, GREEN, summary.closingBalance > 0 ? RED : GREEN];
    const cell = ws.getCell(`${col}${totRow}`);
    cell.value  = vals[i];
    cell.numFmt = '#,##0.00';
    cell.font   = { bold: true, size: 11, color: { argb: colors[i] } };
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
  });

  // ── Summary Box ───────────────────────────────────────────
  currentRow += 2;
  const sumData = [
    ['Opening Balance',   summary.openingBalance,    'FF17A2B8'],
    ['Total Debit',       summary.totalDebit,        RED],
    ['Total Credit',      summary.totalCredit,       GREEN],
    ['Closing Balance',   summary.closingBalance,    summary.closingBalance > 0 ? RED : GREEN],
    ['Outstanding Balance', summary.outstandingBalance, summary.outstandingBalance > 0 ? RED : GREEN],
  ];

  ws.mergeCells(`A${currentRow}:C${currentRow}`);
  ws.getCell(`A${currentRow}`).value = 'FINANCIAL SUMMARY';
  Object.assign(ws.getCell(`A${currentRow}`), hStyle(NAVY, WHITE, 12));
  ws.mergeCells(`D${currentRow}:N${currentRow}`);
  ws.getRow(currentRow).height = 22;
  currentRow++;

  sumData.forEach(([label, value, color]) => {
    ws.mergeCells(`A${currentRow}:C${currentRow}`);
    ws.mergeCells(`D${currentRow}:G${currentRow}`);
    const lCell = ws.getCell(`A${currentRow}`);
    lCell.value = label;
    lCell.font  = { bold: true, size: 10 };
    lCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: LGRAY } };
    lCell.alignment = { horizontal: 'left', vertical: 'middle' };
    lCell.border = { bottom: { style: 'hair' } };

    const vCell = ws.getCell(`D${currentRow}`);
    vCell.value  = value;
    vCell.numFmt = '#,##0.00';
    vCell.font   = { bold: true, size: 11, color: { argb: color } };
    vCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LGRAY } };
    vCell.alignment = { horizontal: 'right', vertical: 'middle' };
    vCell.border = { bottom: { style: 'hair' } };
    ws.getRow(currentRow).height = 20;
    currentRow++;
  });

  // ── Write File ────────────────────────────────────────────
  const exportsDir = ensureExportsDir();
  const safeName   = sanitizeFileName(customer.name);
  const fileName   = `${safeName}_Statement_${new Date().toISOString().split('T')[0]}.xlsx`;
  const filePath   = path.join(exportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);
  res.download(filePath, fileName, (err) => { if (err) console.error(err); fs.unlink(filePath, () => {}); });
});

// ============================================================
// Customer Statement — PDF Export (Professional Accounting)
// ============================================================
exports.pdfCustomerStatement = catchAsync(async (req, res, next) => {
  const { name, startDate, endDate } = req.body;
  if (!name) return next(new AppError('Customer name is required', 400));

  const data = await buildStatementData({ name, startDate, endDate, companyId: req.companyId });
  if (!data) return next(new AppError('Customer not found', 404));

  const { customer, entries, summary, period } = data;

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  const exportsDir = ensureExportsDir();
  const safeName   = sanitizeFileName(customer.name);
  const fileName   = `${safeName}_Statement_${new Date().toISOString().split('T')[0]}.pdf`;
  const filePath   = path.join(exportsDir, fileName);
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  const PW = doc.page.width  - 80;   // page width minus margins
  const ML = 40;                      // margin left

  // ── Fonts & Colours ───────────────────────────────────────
  const NAVY_R = [10,  15,  77];
  const GRN_R  = [40, 167, 69];
  const RED_R  = [220, 53, 69];
  const GRY_R  = [108, 117, 125];

  // ── Header Band ───────────────────────────────────────────
  doc.rect(ML, 30, PW, 40).fill(NAVY_R);
  doc.fillColor('white').fontSize(16).font('Helvetica-Bold')
    .text('CUSTOMER ACCOUNT STATEMENT', ML + 10, 42, { width: PW - 20, align: 'center' });
  doc.moveDown(0.2);

  // ── Customer Info ─────────────────────────────────────────
  let y = 82;
  doc.rect(ML, y, PW, 56).fillAndStroke([240, 240, 245], [220, 220, 225]);
  doc.fillColor(NAVY_R).fontSize(9).font('Helvetica-Bold');
  doc.text('Customer:', ML + 10, y + 8);
  doc.font('Helvetica').fillColor('black').text(customer.name, ML + 70, y + 8);
  doc.fillColor(NAVY_R).font('Helvetica-Bold').text('Email:', ML + 10, y + 22);
  doc.font('Helvetica').fillColor('black').text(customer.email || '—', ML + 70, y + 22);
  doc.fillColor(NAVY_R).font('Helvetica-Bold').text('Phone:', ML + 10, y + 36);
  doc.font('Helvetica').fillColor('black').text(customer.phone || '—', ML + 70, y + 36);

  const periodLabel = period.startDate ? `${fmtDate(period.startDate)} — ${fmtDate(period.endDate)}` : 'Full History';
  doc.fillColor(NAVY_R).font('Helvetica-Bold').text('Period:', ML + 320, y + 8);
  doc.font('Helvetica').fillColor('black').text(periodLabel, ML + 370, y + 8, { width: 200 });
  doc.fillColor(NAVY_R).font('Helvetica-Bold').text('Generated:', ML + 320, y + 22);
  doc.font('Helvetica').fillColor('black').text(fmtDate(new Date()), ML + 390, y + 22);
  doc.fillColor(NAVY_R).font('Helvetica-Bold').text('Outstanding:', ML + 320, y + 36);
  doc.fillColor(summary.outstandingBalance > 0 ? RED_R : GRN_R).font('Helvetica-Bold')
    .text(fmtNum(summary.outstandingBalance), ML + 395, y + 36);

  y += 66;

  // ── Table Header ──────────────────────────────────────────
  const COLS = [
    { label: 'Date',        x: ML,       w: 62  },
    { label: 'Type',        x: ML + 62,  w: 80  },
    { label: 'Reference',   x: ML + 142, w: 60  },
    { label: 'Description', x: ML + 202, w: 150 },
    { label: 'Inv #',       x: ML + 352, w: 55  },
    { label: 'Product',     x: ML + 407, w: 80  },
    { label: 'Qty',         x: ML + 487, w: 28  },
    { label: 'Unit Price',  x: ML + 515, w: 55  },
    { label: 'Debit',       x: ML + 570, w: 55  },
    { label: 'Credit',      x: ML + 625, w: 55  },
    { label: 'Balance',     x: ML + 680, w: 65  },
  ];

  const drawTableHeader = (yPos) => {
    doc.rect(ML, yPos, PW, 16).fill(NAVY_R);
    doc.fillColor('white').fontSize(7).font('Helvetica-Bold');
    COLS.forEach((c) => doc.text(c.label, c.x + 2, yPos + 5, { width: c.w - 4, align: 'right' }));
    return yPos + 16;
  };

  y = drawTableHeader(y);

  // ── Data Rows ─────────────────────────────────────────────
  let rowIdx = 0;
  const PAGE_H = doc.page.height - 80;

  entries.forEach((entry) => {
    const rowItems = (entry.items && entry.items.length > 0) ? entry.items : [null];

    rowItems.forEach((item, itemIdx) => {
      if (y + 14 > PAGE_H) {
        doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' });
        y = drawTableHeader(30);
        rowIdx = 0;
      }

      const bg = rowIdx % 2 === 0 ? [255, 255, 255] : [248, 248, 252];
      doc.rect(ML, y, PW, 13).fill(bg).stroke([220, 220, 220]);

      doc.fillColor('black').font('Helvetica').fontSize(7);

      if (itemIdx === 0) {
        doc.text(fmtDate(entry.date),         COLS[0].x + 2, y + 3, { width: COLS[0].w - 4, align: 'left'  });
        doc.text(entry.type,                  COLS[1].x + 2, y + 3, { width: COLS[1].w - 4, align: 'left'  });
        doc.fillColor(NAVY_R).font('Helvetica-Bold');
        doc.text(entry.reference,             COLS[2].x + 2, y + 3, { width: COLS[2].w - 4, align: 'center' });
        doc.fillColor('black').font('Helvetica');
        doc.text(entry.description.substring(0, 45), COLS[3].x + 2, y + 3, { width: COLS[3].w - 4, align: 'left' });
        doc.text(entry.invoiceNumber || '—',  COLS[4].x + 2, y + 3, { width: COLS[4].w - 4, align: 'center' });

        if (entry.debit > 0) {
          doc.fillColor(RED_R).font('Helvetica-Bold').text(fmtNum(entry.debit), COLS[8].x + 2, y + 3, { width: COLS[8].w - 4, align: 'right' });
          doc.fillColor(GRY_R).font('Helvetica').text('—', COLS[9].x + 2, y + 3, { width: COLS[9].w - 4, align: 'right' });
        } else {
          doc.fillColor(GRY_R).font('Helvetica').text('—', COLS[8].x + 2, y + 3, { width: COLS[8].w - 4, align: 'right' });
          doc.fillColor(GRN_R).font('Helvetica-Bold').text(fmtNum(entry.credit), COLS[9].x + 2, y + 3, { width: COLS[9].w - 4, align: 'right' });
        }
        const balColor = entry.balance > 0 ? RED_R : GRN_R;
        doc.fillColor(balColor).font('Helvetica-Bold').text(fmtNum(entry.balance), COLS[10].x + 2, y + 3, { width: COLS[10].w - 4, align: 'right' });
      }

      if (item) {
        doc.fillColor('black').font('Helvetica');
        doc.text(item.productName.substring(0, 18), COLS[5].x + 2, y + 3, { width: COLS[5].w - 4, align: 'left'  });
        doc.text(String(item.quantity),              COLS[6].x + 2, y + 3, { width: COLS[6].w - 4, align: 'right' });
        doc.text(fmtNum(item.unitPrice),             COLS[7].x + 2, y + 3, { width: COLS[7].w - 4, align: 'right' });
      }

      y += 13;
      rowIdx++;
    });
  });

  // ── Totals Row ────────────────────────────────────────────
  if (y + 14 > PAGE_H) { doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' }); y = 30; }
  doc.rect(ML, y, PW, 14).fill(NAVY_R);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(8);
  doc.text('PERIOD TOTALS', ML + 2, y + 3, { width: COLS[7].x + COLS[7].w - ML, align: 'right' });
  doc.fillColor(RED_R).text(fmtNum(summary.totalDebit),  COLS[8].x + 2, y + 3, { width: COLS[8].w - 4,  align: 'right' });
  doc.fillColor(GRN_R).text(fmtNum(summary.totalCredit), COLS[9].x + 2, y + 3, { width: COLS[9].w - 4,  align: 'right' });
  const cbColor = summary.closingBalance > 0 ? RED_R : GRN_R;
  doc.fillColor(cbColor).text(fmtNum(summary.closingBalance), COLS[10].x + 2, y + 3, { width: COLS[10].w - 4, align: 'right' });
  y += 20;

  // ── Financial Summary Box ─────────────────────────────────
  if (y + 90 > PAGE_H) { doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' }); y = 30; }
  const sumBoxW = 240;
  const sumBoxX = doc.page.width - 40 - sumBoxW;

  doc.rect(sumBoxX, y, sumBoxW, 18).fill(NAVY_R);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(9).text('FINANCIAL SUMMARY', sumBoxX + 4, y + 5, { width: sumBoxW - 8, align: 'center' });
  y += 18;

  const sumRows = [
    ['Opening Balance',    summary.openingBalance,    [220, 220, 220]],
    ['Total Debit',        summary.totalDebit,        [255, 235, 235]],
    ['Total Credit',       summary.totalCredit,       [235, 255, 235]],
    ['Closing Balance',    summary.closingBalance,    [235, 235, 255]],
    ['Outstanding Balance', summary.outstandingBalance, [255, 248, 220]],
  ];
  sumRows.forEach(([label, value, bg]) => {
    doc.rect(sumBoxX, y, sumBoxW, 15).fillAndStroke(bg, [200, 200, 200]);
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8).text(label + ':', sumBoxX + 6, y + 4, { width: 140 });
    const isNeg = value < 0;
    const vColor = label.includes('Debit') ? RED_R : label.includes('Credit') ? GRN_R : value > 0 ? RED_R : GRN_R;
    doc.fillColor(vColor).font('Helvetica-Bold').text(fmtNum(value), sumBoxX + 6, y + 4, { width: sumBoxW - 12, align: 'right' });
    y += 15;
  });

  doc.end();
  writeStream.on('finish', () => {
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading PDF:', err);
      fs.unlink(filePath, () => {});
    });
  });
});

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

  sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
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
