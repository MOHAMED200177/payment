'use strict';
/**
 * One-time fix: Drop stale legacy indexes from before multi-tenant migration.
 *
 * Problem: Old `name_1` unique index on `counters` collection blocks any
 * second company from having a counter named "invoice", "salesOrder", etc.
 * The correct index is the compound: { company: 1, name: 1 }
 *
 * Run once: node scripts/fix-counter-index.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env', '.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.DATABASE || process.env.MONGO_URI || 'mongodb://localhost:27017/payment';

const dropIfExists = async (collectionName, indexName) => {
  try {
    const col = mongoose.connection.collection(collectionName);
    const indexes = await col.indexes();
    const exists = indexes.find(i => i.name === indexName);
    if (exists) {
      await col.dropIndex(indexName);
      console.log(`✅  Dropped index "${indexName}" from "${collectionName}"`);
    } else {
      console.log(`⏭️   Index "${indexName}" not found on "${collectionName}" — skipping`);
    }
    console.log(`   Current indexes on "${collectionName}":`, indexes.map(i => i.name).join(', '));
  } catch (err) {
    console.error(`❌  Error on "${collectionName}.${indexName}":`, err.message);
  }
};

(async () => {
  console.log('\n🔌  Connecting to:', MONGO_URI);
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅  Connected.\n');

  // Drop the old global-unique name index on counters
  await dropIfExists('counters', 'name_1');

  // Drop old global invoiceNumber index on invoices (if any)
  await dropIfExists('invoices', 'invoiceNumber_1');

  // Drop old global orderNumber index on salesorders (if any)
  await dropIfExists('salesorders', 'orderNumber_1');

  console.log('\n🎉  Done. Backend can now be restarted safely.\n');
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
