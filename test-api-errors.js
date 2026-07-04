require('dotenv').config({ path: './.env/.env' });
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
  console.log('Logging in...');
  const login = await request('POST', '/auth/login', { companySlug: 'tele-1783121447721', username: 'moha', password: '12345678' });
  const token = login.body.token || login.body.data?.token;

  console.log('\n--- Test 1: Missing Required Fields (Supplier) ---');
  const r1 = await request('POST', '/supplier', { name: '' }, token);
  console.log(`Status: ${r1.status}`);
  console.log(`Response:`, r1.body);

  console.log('\n--- Test 2: Invalid Enum (Expense) ---');
  const r2 = await request('POST', '/expenses', { 
    category: 'INVALID_CATEGORY', 
    amount: 100, 
    date: new Date().toISOString(),
    description: 'Test',
    paymentMethod: 'Cash',
    status: 'paid'
  }, token);
  console.log(`Status: ${r2.status}`);
  console.log(`Response:`, r2.body);

  console.log('\n--- Test 3: Duplicate Key (Category) ---');
  // Create first
  await request('POST', '/categories', { name: 'DUP_TEST_123', description: 'test' }, token);
  // Try duplicate
  const r3 = await request('POST', '/categories', { name: 'DUP_TEST_123', description: 'test' }, token);
  console.log(`Status: ${r3.status}`);
  console.log(`Response:`, r3.body);
  
  process.exit(0);
}

run();
