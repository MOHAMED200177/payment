require('dotenv').config({path: './.env/.env'});
const axios = require('axios');
const mongoose = require('mongoose');

const dbUrl = process.env.DATABASE.replace('\n', '').replace('\r', '');
mongoose.connect(dbUrl, { useNewUrlParser: true })
  .then(() => console.log('DB connected'))
  .catch(err => console.log(err));

const Invoice = require('./models/invoice');

async function testReturn() {
  try {
    const invoice = await Invoice.findOne({ isDeleted: { $ne: true }, status: 'issued' }).populate('customer').populate('items.product');
    if (!invoice) throw new Error("No invoice found");
    
    console.log('Found invoice:', invoice.invoiceNumber);

    const API_URL = 'http://localhost:8000';
    const User = require('./models/user.model');
    const user = await User.findOne({ company: invoice.company });
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: user._id, company: invoice.company }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1d' });

    console.log('Calling API...');
    const res = await axios.post(`${API_URL}/return/add`, {
      invoiceNumber: invoice.invoiceNumber,
      productName: invoice.items[0].product.name,
      name: invoice.customer.name,
      quantity: 1,
      reason: 'Defective'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('API SUCCESS:', res.status, res.data);
    process.exit(0);
  } catch (err) {
    console.log('API FAILED');
    if (err.response) {
      console.log(err.response.status, err.response.data);
    } else {
      console.log(err.message);
    }
    process.exit(1);
  }
}

setTimeout(testReturn, 1000);
