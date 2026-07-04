require('dotenv').config({ path: './.env' });
const http = require('http');

async function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 8000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('--- Registering Test User ---');
  const uniqueId = Date.now();
  const reg = await request('POST', '/auth/register', {
    companyName: `TestCo${uniqueId}`,
    fullName: 'Test User',
    name: 'Test User',
    username: `test${uniqueId}`,
    email: `test${uniqueId}@test.com`,
    password: 'password123',
    phone: '123456789'
  });
  
  if (reg.status !== 201) {
    console.log('Registration failed:', reg.body);
    return;
  }
  const token = reg.body.data?.token;
  if (!token) {
    console.log('No token returned:', reg.body);
    return;
  }
  console.log('Logged in successfully!');

  console.log('\n1. Test Customer with only required fields (name only)');
  const r1 = await request('POST', '/customers', { name: 'Customer 1' }, token);
  console.log(`Status: ${r1.status}`, r1.status === 201 ? '✅ PASS' : '❌ FAIL', r1.body.message || '');

  console.log('\n2. Test Customer with all fields completed');
  const r2 = await request('POST', '/customers', { name: 'Customer 2', email: 'c2@test.com', phone: '5551234', address: '123 Main' }, token);
  console.log(`Status: ${r2.status}`, r2.status === 201 ? '✅ PASS' : '❌ FAIL', r2.body.message || '');

  console.log('\n3. Test Customer without email (empty string)');
  const r3 = await request('POST', '/customers', { name: 'Customer 3', email: '', phone: '5559876' }, token);
  console.log(`Status: ${r3.status}`, r3.status === 201 ? '✅ PASS' : '❌ FAIL', r3.body.message || '');

  console.log('\n4. Test Duplicate customer');
  const r4 = await request('POST', '/customers', { name: 'Customer 1' }, token);
  console.log(`Status: ${r4.status}`, r4.status === 400 ? '✅ PASS (Expected 400)' : '❌ FAIL', r4.body.message || '');

  console.log('\n5. Test Invalid phone number');
  // Wait, there is no phone validation in schema
  const r5 = await request('POST', '/customers', { name: 'Customer 5', phone: 'not-a-phone' }, token);
  console.log(`Status: ${r5.status}`, r5.status === 201 ? '✅ PASS (No phone validation schema)' : '❌ FAIL', r5.body.message || '');

  console.log('\n6. Test Invalid email');
  const r6 = await request('POST', '/customers', { name: 'Customer 6', email: 'invalid-email' }, token);
  console.log(`Status: ${r6.status}`, r6.status === 400 ? '✅ PASS (Expected 400)' : '❌ FAIL', r6.body.message || '');
}
run();
