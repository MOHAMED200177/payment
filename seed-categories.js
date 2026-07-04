/**
 * Seed categories and suppliers for the 'tele' company (moha's company)
 * so CreateProduct can be tested properly.
 */
require('dotenv').config({ path: './.env/.env' });
const mongoose = require('mongoose');

const Category = require('./models/category');
const Supplier = require('./models/supplier');
const Company  = require('./models/company.model');

async function run() {
  await mongoose.connect(process.env.DATABASE);
  console.log('Connected.\n');

  // Find the tele company
  const company = await Company.findOne({ slug: /tele/i }).lean();
  if (!company) {
    console.error('Company not found!');
    return;
  }
  console.log(`Seeding for company: ${company.name} (${company._id})\n`);

  // Seed categories
  const categoryNames = ['إلكترونيات', 'ملابس', 'أغذية', 'أجهزة منزلية', 'مواد خام'];
  let catCreated = 0;
  for (const name of categoryNames) {
    const exists = await Category.findOne({ company: company._id, name });
    if (!exists) {
      await Category.create({ name, company: company._id, description: '' });
      console.log(`  Created category: ${name}`);
      catCreated++;
    } else {
      console.log(`  Category already exists: ${name}`);
    }
  }

  // Seed suppliers
  const supplierData = [
    { name: 'المورد الأول', phone: '0101234567', email: 'supplier1@example.com' },
    { name: 'المورد الثاني', phone: '0109876543', email: 'supplier2@example.com' },
    { name: 'شركة التوريد العامة', phone: '0123456789', email: 'general@example.com' },
  ];
  let supCreated = 0;
  for (const s of supplierData) {
    const exists = await Supplier.findOne({ company: company._id, name: s.name });
    if (!exists) {
      await Supplier.create({ ...s, company: company._id });
      console.log(`  Created supplier: ${s.name}`);
      supCreated++;
    } else {
      console.log(`  Supplier already exists: ${s.name}`);
    }
  }

  console.log(`\nSeeding complete: ${catCreated} categories, ${supCreated} suppliers added.`);

  // Verify
  const cats = await Category.find({ company: company._id, isDeleted: { $ne: true } }).lean();
  const sups = await Supplier.find({ company: company._id, isDeleted: { $ne: true } }).lean();
  console.log(`\nVerification:`);
  console.log(`  Categories (${cats.length}): ${cats.map(c => c.name + ' [' + c._id + ']').join(', ')}`);
  console.log(`  Suppliers (${sups.length}): ${sups.map(s => s.name + ' [' + s._id + ']').join(', ')}`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch(console.error);
