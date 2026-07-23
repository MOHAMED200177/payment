const axios = require('axios');

const API_URL = 'http://localhost:8000';

async function testReturn() {
  try {
    // 1. login to get token
    const loginRes = await axios.post(API_URL + "/auth/login", {
      companyName: "Test Company 1784550863202", // from previous task
      username: "admin_1784550863202",
      password: "password123"
    });
    const token = loginRes.data.data.token;
    console.log('Logged in');
    
    // 2. Fetch required data (invoice, customer, product)
    const headers = { Authorization: `Bearer ${token}` };
    
    const customers = await axios.get(API_URL + "/customers", { headers });
    const products = await axios.get(API_URL + "/product", { headers });
    const invoices = await axios.get(API_URL + "/invoices", { headers });
    
    console.log('Customers count:', customers.data.data.length);
    console.log('Products count:', products.data.data.length);
    console.log('Invoices count:', invoices.data.data.length);
    
    // We don't have any products/customers/invoices since this is a new company!
    // I need to create them first to test return properly.
    
  } catch(err) {
    console.log('TEST FAILED');
    if (err.response) {
      console.log(err.response.status, err.response.data);
    } else {
      console.log(err);
    }
  }
}
testReturn();
