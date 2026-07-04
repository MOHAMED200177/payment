const mongoose = require('mongoose');
const Customer = require('./models/customer');

function run() {
  const doc = new Customer({ company: new mongoose.Types.ObjectId(), name: 'Test', email: '', address: '', phone: '' });
  const err = doc.validateSync();
  if (err) {
    console.log('Error Name:', err.name);
    console.log('Error Message:', err.message);
    console.log('Errors:', Object.keys(err.errors));
  } else {
    console.log('Validation passed!');
  }
}
run();
