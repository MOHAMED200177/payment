#!/usr/bin/env node
'use strict';
/**
 * Migration: Single-tenant → Multi-tenant
 *
 * This script should be run ONCE on existing data.
 * It creates one Company, one Admin user, and stamps all existing
 * documents with the company ObjectId.
 *
 * Usage:
 *   COMPANY_NAME="My Company" ADMIN_USERNAME="admin" ADMIN_PASSWORD="yourpassword" \
 *   node scripts/migrate-to-multitenant.js
 *
 * The script is idempotent: if company already exists it will skip creation
 * and only stamp documents that are missing a company field.
 */
const dotenv = require('dotenv');
dotenv.config({ path: './.env/.env' });

const mongoose = require('mongoose');
const crypto = require('crypto');

const COMPANY_NAME   = process.env.COMPANY_NAME   || 'Default Company';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME  || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_PASSWORD environment variable is required');
  process.exit(1);
}

async function run() {
  await mongoose.connect(process.env.DATABASE);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  // ── Step 1: Create Company ─────────────────────────────────
  let companyId;
  let recoveryKeyPlain;

  const existingCompany = await db.collection('companies').findOne({ name: COMPANY_NAME });

  if (existingCompany) {
    console.log(`Company already exists: ${COMPANY_NAME} (${existingCompany._id})`);
    companyId = existingCompany._id;
  } else {
    const plain = crypto.randomBytes(32).toString('hex');
    const hash  = crypto.createHash('sha256').update(plain).digest('hex');
    recoveryKeyPlain = plain;

    const slug =
      COMPANY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') +
      '-' + Date.now();

    const result = await db.collection('companies').insertOne({
      name: COMPANY_NAME,
      slug,
      active: true,
      recoveryKeyHash: hash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    companyId = result.insertedId;
    console.log(`Created company: ${COMPANY_NAME} (${companyId})`);
    console.log('\n*** SAVE THIS RECOVERY KEY — SHOWN ONCE ***');
    console.log(`Recovery Key: ${recoveryKeyPlain}`);
    console.log('********************************************\n');
  }

  // ── Step 2: Create Admin User ─────────────────────────────
  const bcrypt = require('bcryptjs');
  const existingAdmin = await db.collection('users').findOne({ company: companyId, role: 'ADMIN' });

  if (existingAdmin) {
    console.log(`Admin user already exists: ${existingAdmin.username}`);
  } else {
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await db.collection('users').insertOne({
      company: companyId,
      username: ADMIN_USERNAME.toLowerCase(),
      name: 'System Administrator',
      password: hashedPassword,
      role: 'ADMIN',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`Created admin user: ${ADMIN_USERNAME}`);
  }

  // ── Step 3: Stamp all existing collections ─────────────────
  const collections = [
    'customers', 'suppliers', 'products', 'categories', 'stocks',
    'invoices', 'payments', 'returns', 'transactions', 'salesorders',
    'purchaseorders', 'supplierpayments', 'expenses', 'cashTransactions',
    'prescriptions', 'counters',
  ];

  for (const col of collections) {
    try {
      const result = await db.collection(col).updateMany(
        { company: { $exists: false } },    // only docs without company
        { $set: { company: companyId } }
      );
      if (result.modifiedCount > 0) {
        console.log(`Stamped ${result.modifiedCount} documents in ${col}`);
      } else {
        console.log(`${col}: already stamped or empty`);
      }
    } catch (err) {
      console.warn(`Warning: could not stamp ${col}: ${err.message}`);
    }
  }

  // ── Step 4: Update unique indexes (drop old global, create per-company) ──
  console.log('\nNote: You must manually drop and recreate indexes after migration.');
  console.log('Run the following in MongoDB shell:');
  console.log('  db.customers.dropIndex("name_1")');
  console.log('  db.customers.dropIndex("email_1")');
  console.log('  db.customers.dropIndex("phone_1")');
  console.log('  db.suppliers.dropIndex("name_1")');
  console.log('  db.products.dropIndex("name_1")');
  console.log('  db.products.dropIndex("productCode_1")');
  console.log('  db.categories.dropIndex("name_1")');
  console.log('  (Mongoose will recreate compound indexes on next app start)');

  console.log('\nMigration complete.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
