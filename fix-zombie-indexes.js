'use strict';
/**
 * Fix zombie indexes on the purchaseorders collection.
 *
 * Problem: an old single-field unique index `orderNumber_1` was left over
 * from before the multi-tenant migration. It conflicts with the correct
 * compound index { company: 1, orderNumber: 1 }, causing duplicate-key
 * errors as soon as a second purchase order is created (even across
 * different companies).
 *
 * Run once:  node fix-zombie-indexes.js
 */

const dotenv = require('dotenv');
dotenv.config({ path: './.env/.env' });

const mongoose = require('mongoose');

const DB = process.env.DATABASE;

const COLLECTION = 'purchaseorders';

// Any legacy single-field indexes that shouldn't exist anymore.
// Add more names here if you find similar zombies on other collections.
const ZOMBIE_INDEX_NAMES = ['orderNumber_1'];

// The correct compound index that MUST exist after cleanup.
const REQUIRED_INDEX = { key: { company: 1, orderNumber: 1 }, options: { unique: true } };

async function run() {
  if (!DB) {
    console.error('❌ process.env.DATABASE is not set. Check ./.env/.env');
    process.exit(1);
  }

  await mongoose.connect(DB, { useNewUrlParser: true });
  console.log('✅ DB connection successful\n');

  const db = mongoose.connection.db;
  const collections = await db.listCollections({ name: COLLECTION }).toArray();

  if (!collections.length) {
    console.log(`⚠️  Collection "${COLLECTION}" does not exist yet — nothing to fix.`);
    await mongoose.disconnect();
    return;
  }

  const collection = db.collection(COLLECTION);

  console.log(`📋 Current indexes on "${COLLECTION}":`);
  const existingIndexes = await collection.indexes();
  existingIndexes.forEach((ix) => {
    console.log(`   - ${ix.name}: ${JSON.stringify(ix.key)}${ix.unique ? ' (unique)' : ''}`);
  });
  console.log('');

  // 1) Drop zombie indexes
  for (const zombieName of ZOMBIE_INDEX_NAMES) {
    const found = existingIndexes.find((ix) => ix.name === zombieName);
    if (found) {
      console.log(`🗑️  Dropping zombie index "${zombieName}"...`);
      await collection.dropIndex(zombieName);
      console.log(`   ✅ Dropped.`);
    } else {
      console.log(`ℹ️  Zombie index "${zombieName}" not found (already clean).`);
    }
  }
  console.log('');

  // 2) Make sure the correct compound index exists
  const refreshedIndexes = await collection.indexes();
  const hasRequired = refreshedIndexes.some(
    (ix) => JSON.stringify(ix.key) === JSON.stringify(REQUIRED_INDEX.key) && ix.unique
  );

  if (hasRequired) {
    console.log('✅ Required compound index { company: 1, orderNumber: 1 } (unique) already present.');
  } else {
    console.log('🔧 Creating required compound index { company: 1, orderNumber: 1 } (unique)...');
    await collection.createIndex(REQUIRED_INDEX.key, REQUIRED_INDEX.options);
    console.log('   ✅ Created.');
  }

  console.log('\n📋 Final indexes:');
  const finalIndexes = await collection.indexes();
  finalIndexes.forEach((ix) => {
    console.log(`   - ${ix.name}: ${JSON.stringify(ix.key)}${ix.unique ? ' (unique)' : ''}`);
  });

  await mongoose.disconnect();
  console.log('\n🎉 Done. Try creating a purchase order again.');
}

run().catch((err) => {
  console.error('❌ Error while fixing indexes:', err);
  process.exit(1);
});
