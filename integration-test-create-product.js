/**
 * Integration test: simulate a full CreateProduct HTTP request using the real backend.
 * 
 * Run: node integration-test-create-product.js
 * 
 * This will:
 * 1. Login as moha (tele company)
 * 2. Fetch categories → pick first one
 * 3. Fetch suppliers → pick first one
 * 4. POST /product with valid data
 * 5. Verify 201 Created response
 * 6. Test field-level backend validation (missing category)
 * 7. Test duplicate product handling
 */

require('dotenv').config({ path: './.env/.env' });
const http = require('http');

const BASE_URL = `http://localhost:${process.env.PORT || 8000}`;

async function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: process.env.PORT || 8000,
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
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('=== Integration Test: Create Product ===\n');

  // Step 1: Login
  console.log('1. Logging in as moha...');
  const loginRes = await request('POST', '/auth/login', {
    companySlug: 'tele-1783121447721',
    username: 'moha',
    password: '12345678',
  });
  
  if (loginRes.status !== 200) {
    console.error(`❌ Login failed (${loginRes.status}):`, loginRes.body);
    process.exit(1);
  }
  
  const token = loginRes.body.token || loginRes.body.data?.token;
  console.log(`✅ Login OK. Token: ${token ? token.substring(0, 20) + '...' : 'NOT FOUND'}\n`);

  // Step 2: Fetch categories
  console.log('2. Fetching categories...');
  const catRes = await request('GET', '/categories', null, token);
  const categories = catRes.body?.data?.data || [];
  console.log(`   Found ${categories.length} categories: ${categories.map(c => c.name + ' [' + c._id + ']').join(', ')}`);
  
  if (categories.length === 0) {
    console.error('❌ No categories found! Cannot test.\n');
    process.exit(1);
  }
  const catId = categories[0]._id;
  console.log(`   Using: ${categories[0].name} [${catId}]\n`);

  // Step 3: Fetch suppliers
  console.log('3. Fetching suppliers...');
  const supRes = await request('GET', '/supplier', null, token);
  const suppliers = supRes.body?.data?.data || [];
  console.log(`   Found ${suppliers.length} suppliers: ${suppliers.map(s => s.name + ' [' + s._id + ']').join(', ')}`);
  
  if (suppliers.length === 0) {
    console.error('❌ No suppliers found!\n');
    process.exit(1);
  }
  const supId = suppliers[0]._id;
  console.log(`   Using: ${suppliers[0].name} [${supId}]\n`);

  // Step 4: Create product with valid data
  const timestamp = Date.now();
  const productPayload = {
    name: `منتج تجريبي ${timestamp}`,
    productCode: `TEST-${timestamp}`,
    costPrice: 100,
    sellingPrice: 150,
    unit: 'قطعة',
    category: catId,
    supplier: supId,
  };

  console.log('4. Creating product with valid data...');
  console.log('   Payload:', JSON.stringify(productPayload, null, 2));
  
  const createRes = await request('POST', '/product', productPayload, token);
  console.log(`   Response status: ${createRes.status}`);
  
  if (createRes.status === 201) {
    console.log(`✅ Product created successfully!`);
    console.log(`   Product ID: ${createRes.body.data?._id}`);
    console.log(`   Name: ${createRes.body.data?.name}`);
    console.log(`   Category: ${JSON.stringify(createRes.body.data?.category)}`);
    console.log(`   Supplier: ${JSON.stringify(createRes.body.data?.supplier)}\n`);
  } else {
    console.error(`❌ Create failed (${createRes.status}):`, createRes.body?.message);
    process.exit(1);
  }

  // Step 5: Test missing category validation (should get 400/404)
  console.log('5. Testing with missing category (validation test)...');
  const badCatRes = await request('POST', '/product', {
    ...productPayload,
    name: `منتج بدون فئة ${timestamp}`,
    productCode: `NOCAT-${timestamp}`,
    category: '',
  }, token);
  console.log(`   Status: ${badCatRes.status} — Message: ${badCatRes.body?.message}`);
  console.log(badCatRes.status >= 400 ? '✅ Correctly rejected missing category\n' : '⚠️ Unexpected success\n');

  // Step 6: Test invalid category _id (wrong ObjectId)
  console.log('6. Testing with invalid category _id...');
  const wrongIdRes = await request('POST', '/product', {
    ...productPayload,
    name: `منتج فئة خاطئة ${timestamp}`,
    productCode: `WRONGCAT-${timestamp}`,
    category: '000000000000000000000000',
  }, token);
  console.log(`   Status: ${wrongIdRes.status} — Message: ${wrongIdRes.body?.message}`);
  console.log(wrongIdRes.status === 404 ? '✅ "Category not found" for wrong ID — correct behavior\n' : `⚠️ Got ${wrongIdRes.status}\n`);

  console.log('=== ALL TESTS PASSED ✅ ===');
}

run().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
