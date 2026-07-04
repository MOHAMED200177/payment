/**
 * Verify the exact lookup that createProduct controller does.
 */
require('dotenv').config({ path: './.env/.env' });
const mongoose = require('mongoose');
const Category = require('./models/category');
const Supplier = require('./models/supplier');
const Company  = require('./models/company.model');

async function run() {
  await mongoose.connect(process.env.DATABASE);
  console.log('Connected.\n');

  const company = await Company.findOne({ slug: /tele/i }).lean();
  const companyId = company._id;

  const cats = await Category.find({ company: companyId, isDeleted: { $ne: true } }).lean();
  const sups = await Supplier.find({ company: companyId, isDeleted: { $ne: true } }).lean();

  console.log('=== Testing exact controller query ===');
  
  // Simulate what the frontend sends: _id as string (from JSON)
  const catIdStr = String(cats[0]._id);
  const supIdStr = String(sups[0]._id);
  
  console.log(`\nCategory _id string: "${catIdStr}"`);
  console.log(`Supplier _id string: "${supIdStr}"`);

  // Test 1: findOne with _id string + tenantFilter
  const tenantFilter = { company: companyId };
  
  const catResult = await Category.findOne({ _id: catIdStr, ...tenantFilter });
  console.log(`\nCategory.findOne(_id: string, company): ${catResult ? `FOUND: ${catResult.name}` : 'NOT FOUND!'}`);
  
  const supResult = await Supplier.findOne({ _id: supIdStr, ...tenantFilter });
  console.log(`Supplier.findOne(_id: string, company): ${supResult ? `FOUND: ${supResult.name}` : 'NOT FOUND!'}`);

  // Test 2: also test with ObjectId
  const catIdObj = new mongoose.Types.ObjectId(catIdStr);
  const catResult2 = await Category.findOne({ _id: catIdObj, ...tenantFilter });
  console.log(`\nCategory.findOne(_id: ObjectId, company): ${catResult2 ? `FOUND: ${catResult2.name}` : 'NOT FOUND!'}`);
  
  console.log('\n=== CONCLUSION ===');
  if (catResult && supResult) {
    console.log('✅ Both lookups succeed. CreateProduct should now work for company tele.');
    console.log('\nExample valid payload for CreateProduct API:');
    console.log(JSON.stringify({
      name: 'منتج تجريبي',
      productCode: 'TEST-001',
      costPrice: 100,
      sellingPrice: 150,
      unit: 'قطعة',
      category: catIdStr,
      supplier: supIdStr,
    }, null, 2));
  } else {
    console.log('❌ Lookup still failing. Further investigation needed.');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch(console.error);
