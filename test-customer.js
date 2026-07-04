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
  console.log('Logging in...');
  const login = await request('POST', '/auth/login', { companySlug: 'tele-1783121447721', username: 'moha', password: '12345678' });
  const token = login.body.token || login.body.data?.token;
  if (!token) {
    console.log('Login failed', login.body);
    return;
  }

  console.log('\n--- Test: Create Customer ---');
  const r1 = await request('POST', '/customers', { name: 'Test Customer 123', email: '', address: '', phone: '' }, token);
  console.log(`Status: ${r1.status}`);
  console.log(`Response:`, r1.body);
}
run();
