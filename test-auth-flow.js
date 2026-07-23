const axios = require('axios');

const API_URL = 'http://localhost:8000';

async function testAuthFlow() {
  try {
    const timestamp = Date.now();
    const companyName = "Test Company " + timestamp;
    const username = "admin_" + timestamp;
    const password = "password123";

    console.log("1. Registering new company: " + companyName);
    const registerRes = await axios.post(API_URL + "/auth/register", {
      companyName,
      username,
      name: 'Test Admin',
      password
    });
    console.log('Register success');

    console.log("2. Logging in...");
    const loginRes = await axios.post(API_URL + "/auth/login", {
      companyName,
      username,
      password
    });
    console.log('Login success');
    
  } catch (err) {
    console.log('TEST FAILED');
    if (err.response) {
      console.log(err.response.status);
      console.log(JSON.stringify(err.response.data, null, 2));
    } else {
      console.log(err);
    }
  }
}
testAuthFlow();
