/**
 * Check all companies and their categories/suppliers
 */
require('dotenv').config({ path: './.env/.env' });
const mongoose = require('mongoose');

const Category = require('./models/category');
const Supplier = require('./models/supplier');
const Company  = require('./models/company.model');
const User     = require('./models/user.model');

async function run() {
  await mongoose.connect(process.env.DATABASE);
  console.log('Connected.\n');

  const companies = await Company.find().lean();
  
  for (const company of companies) {
    const cats = await Category.find({ company: company._id, isDeleted: { $ne: true } }).lean();
    const sups = await Supplier.find({ company: company._id, isDeleted: { $ne: true } }).lean();
    const users = await User.find({ company: company._id }).select('username role').lean();
    
    console.log(`\n===== Company: ${company.name} (${company._id}) =====`);
    console.log(`  Slug: ${company.slug}`);
    console.log(`  Users: ${users.map(u => u.username + '(' + u.role + ')').join(', ')}`);
    console.log(`  Categories (${cats.length}): ${cats.map(c => c.name + ' [' + c._id + ']').join(', ')}`);
    console.log(`  Suppliers (${sups.length}): ${sups.map(s => s.name + ' [' + s._id + ']').join(', ')}`);
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch(console.error);
