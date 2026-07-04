/**
 * Diagnostic script — traces exactly what happens when we call createProduct.
 *
 * Run: node diagnose-category.js
 *
 * This will:
 * 1. Connect to MongoDB
 * 2. Find first company and its categories
 * 3. Show what _id values look like from the API response
 * 4. Simulate what the controller does with those _ids
 */

require('dotenv').config({ path: './.env/.env' });
const mongoose = require('mongoose');

const Category = require('./models/category');
const Supplier = require('./models/supplier');
const Company  = require('./models/company.model');

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.DATABASE);
    console.log('Connected.\n');

    // Step 1: List companies
    const companies = await Company.find().lean().limit(3);
    console.log('=== COMPANIES ===');
    companies.forEach(c => console.log(`  ${c._id} — ${c.name} (slug: ${c.slug})`));

    if (companies.length === 0) {
      console.log('No companies found. Aborting.');
      return;
    }

    const company = companies[0];
    const companyId = company._id;
    console.log(`\n>>> Testing with company: ${company.name} (${companyId})\n`);

    // Step 2: Fetch categories for this company (mimicking CATEGORIES.list)
    const allCategories = await Category.find({ company: companyId }).lean();
    console.log(`=== CATEGORIES (company ${companyId}) ===`);
    allCategories.forEach(c => console.log(`  _id: ${c._id}  name: ${c.name}  isDeleted: ${c.isDeleted}`));

    const liveCategories = await Category.find({ company: companyId, isDeleted: { $ne: true } }).lean();
    console.log(`\n=== LIVE CATEGORIES (isDeleted != true) ===`);
    liveCategories.forEach(c => console.log(`  _id: ${c._id}  name: ${c.name}`));

    if (liveCategories.length === 0) {
      console.log('\nNO LIVE CATEGORIES FOUND. This is why Category not found happens!');
    } else {
      // Step 3: Simulate what createProduct does with the first _id
      const testCatId = liveCategories[0]._id;
      console.log(`\n>>> Simulating controller lookup with _id: ${testCatId} ...`);
      
      const found = await Category.findOne({ _id: testCatId, company: companyId });
      console.log(`Category.findOne({ _id, company }) result: ${found ? `FOUND (${found.name})` : 'NOT FOUND!'}`);
      
      // Step 4: Also test with string version (as it arrives from JSON)
      const testCatIdStr = String(testCatId);
      const found2 = await Category.findOne({ _id: testCatIdStr, company: companyId });
      console.log(`Category.findOne({ _id: string, company }) result: ${found2 ? `FOUND (${found2.name})` : 'NOT FOUND!'}`);
    }

    // Step 5: Suppliers
    const liveSuppliers = await Supplier.find({ company: companyId, isDeleted: { $ne: true } }).lean();
    console.log(`\n=== LIVE SUPPLIERS (isDeleted != true) ===`);
    liveSuppliers.forEach(s => console.log(`  _id: ${s._id}  name: ${s.name}`));

    // Step 6: Check the API response structure that the frontend actually uses
    console.log('\n=== API RESPONSE SIMULATION ===');
    console.log('What /categories returns:');
    const apiResponse = {
      status: 'success',
      data: { data: liveCategories.map(c => ({ _id: c._id, name: c.name })) }
    };
    console.log(JSON.stringify(apiResponse.data.data[0] || 'none', null, 2));

    console.log('\nWhat frontend does: catRes.data?.data?.data || catRes.data?.data');
    console.log(`  catRes.data.data.data length: ${apiResponse.data.data?.length || 0}`);
    console.log(`  First item _id: ${apiResponse.data.data[0]?._id}`);

  } catch (err) {
    console.error('DIAGNOSTIC ERROR:', err.message);
    console.error(err.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected. Done.');
  }
}

run();
