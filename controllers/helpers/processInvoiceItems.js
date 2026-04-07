const Product = require('../../models/product');
const Stock = require('../../models/stock');
const AppError = require('../../utils/appError');

async function processInvoiceItems(items, session) {
  const productNames = items.map((item) => item.product);
  const products = await Product.find({ name: { $in: productNames } }).session(session);

  if (products.length !== productNames.length) {
    const foundNames = products.map((p) => p.name);
    const missing = productNames.filter((name) => !foundNames.includes(name));
    throw new AppError(`Products not found: ${missing.join(', ')}`, 404);
  }

  const productMap = new Map(products.map((p) => [p.name, p]));
  const stocks = await Stock.find({ product: { $in: products.map((p) => p._id) } }).session(session);
  const stockMap = new Map(stocks.map((s) => [s.product.toString(), s]));

  const processedItems = [];
  const stockUpdates = [];
  let subtotal = 0;

  for (const item of items) {
    const product = productMap.get(item.product);
    if (!product) throw new AppError(`Product not found: ${item.product}`, 404);

    const stock = stockMap.get(product._id.toString());
    if (!stock) throw new AppError(`Stock not found for ${item.product}`, 404);

    if (stock.quantity < item.quantity) {
      throw new AppError(
        `Insufficient stock for ${product.name}. Available: ${stock.quantity}`,
        400
      );
    }

    const lineTotal = product.sellingPrice * item.quantity;
    subtotal += lineTotal;

    processedItems.push({
      product: product._id,
      quantity: item.quantity,
      unitPrice: product.sellingPrice,
      taxRate: product.taxes || 0,
      lineTotal,
    });

    stockUpdates.push({
      updateOne: {
        filter: { _id: stock._id },
        update: {
          $inc: { quantity: -item.quantity },
          $set: { lastStockUpdate: new Date() },
        },
      },
    });
  }

  return { processedItems, stockUpdates, subtotal };
}

module.exports = processInvoiceItems;