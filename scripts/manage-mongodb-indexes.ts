/**
 * C2: MongoDB Partial Index Management Script
 *
 * Creates unique partial indexes for:
 * - payments.stripePaymentIntentId (only when string type exists and non-empty)
 * - payments.payosOrderCode (only when string type exists and non-empty)
 * - orders.payosOrderCode (only when string type exists and non-empty)
 *
 * This script is IDEMPOTENT — safe to run multiple times.
 * It checks existing indexes, drops Prisma-created conflicting unique indexes,
 * and creates partial unique indexes that allow multiple null/missing values.
 *
 * Usage:
 *   DRY_RUN=true  npx ts-node scripts/manage-mongodb-indexes.ts   (preview)
 *   DRY_RUN=false npx ts-node scripts/manage-mongodb-indexes.ts   (execute)
 */
import dotenv from 'dotenv';
dotenv.config();

const { MongoClient } = require('mongodb');

const DRY_RUN = (process.env.DRY_RUN || 'true').toLowerCase() === 'true';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  // Extract database name from URL
  const urlObj = new URL(dbUrl);
  const dbName = urlObj.pathname.replace(/^\//, '').split('?')[0] || 'elearning';

  const client = new MongoClient(dbUrl);
  await client.connect();
  const db = client.db(dbName);

  console.log(`\n====== MongoDB Partial Index Manager ======`);
  console.log(`Database: ${dbName}`);
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '🔧 EXECUTE (will modify indexes)'}\n`);

  // ======= PAYMENTS COLLECTION =======
  const payments = db.collection('payments');
  await manageIndex(payments, 'payments', {
    indexName: 'stripePaymentIntentId_unique_partial',
    field: 'stripePaymentIntentId',
    conflictingIndexNames: ['stripePaymentIntentId_1'],
    partialFilterExpression: {
      stripePaymentIntentId: { $type: 'string', $gt: '' },
    },
  });

  await manageIndex(payments, 'payments', {
    indexName: 'payosOrderCode_unique_partial',
    field: 'payosOrderCode',
    conflictingIndexNames: ['payosOrderCode_1'],
    partialFilterExpression: {
      payosOrderCode: { $type: 'string', $gt: '' },
    },
  });

  // ======= ORDERS COLLECTION =======
  const orders = db.collection('orders');
  await manageIndex(orders, 'orders', {
    indexName: 'payosOrderCode_unique_partial',
    field: 'payosOrderCode',
    conflictingIndexNames: ['payosOrderCode_1'],
    partialFilterExpression: {
      payosOrderCode: { $type: 'string', $gt: '' },
    },
  });

  // ======= DATA INTEGRITY CHECK =======
  console.log('\n====== Data Integrity Check ======');

  // Check for duplicate stripePaymentIntentId
  const stripeDups = await payments.aggregate([
    { $match: { stripePaymentIntentId: { $type: 'string', $ne: '' } } },
    { $group: { _id: '$stripePaymentIntentId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (stripeDups.length > 0) {
    console.log(`⚠️  DUPLICATE stripePaymentIntentId found (${stripeDups.length} groups):`);
    for (const dup of stripeDups) {
      console.log(`   - "${dup._id}" appears ${dup.count} times: ${dup.ids.join(', ')}`);
    }
    console.log('   ❌ Cannot create unique index until duplicates are resolved manually.');
  } else {
    console.log('✅ No duplicate stripePaymentIntentId values found');
  }

  // Check for duplicate payosOrderCode in payments
  const payosDupsPayments = await payments.aggregate([
    { $match: { payosOrderCode: { $exists: true, $ne: null } } },
    { $group: { _id: '$payosOrderCode', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (payosDupsPayments.length > 0) {
    console.log(`⚠️  DUPLICATE payosOrderCode in payments (${payosDupsPayments.length} groups):`);
    for (const dup of payosDupsPayments) {
      console.log(`   - "${dup._id}" appears ${dup.count} times: ${dup.ids.join(', ')}`);
    }
    console.log('   ❌ Cannot create unique index until duplicates are resolved manually.');
  } else {
    console.log('✅ No duplicate payosOrderCode values in payments');
  }

  // Check for duplicate payosOrderCode in orders
  const payosDupsOrders = await orders.aggregate([
    { $match: { payosOrderCode: { $exists: true, $ne: null } } },
    { $group: { _id: '$payosOrderCode', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (payosDupsOrders.length > 0) {
    console.log(`⚠️  DUPLICATE payosOrderCode in orders (${payosDupsOrders.length} groups):`);
    for (const dup of payosDupsOrders) {
      console.log(`   - "${dup._id}" appears ${dup.count} times: ${dup.ids.join(', ')}`);
    }
    console.log('   ❌ Cannot create unique index until duplicates are resolved manually.');
  } else {
    console.log('✅ No duplicate payosOrderCode values in orders');
  }

  console.log('\n====== Done ======\n');
  await client.close();
}

async function manageIndex(
  collection: any,
  collectionName: string,
  config: {
    indexName: string;
    field: string;
    conflictingIndexNames: string[];
    partialFilterExpression: any;
  }
) {
  const existingIndexes = await collection.indexes();
  const indexNames = existingIndexes.map((i: any) => i.name);

  console.log(`--- ${collectionName}.${config.field} ---`);

  // Check if our desired partial index already exists
  if (indexNames.includes(config.indexName)) {
    console.log(`  ✅ Partial index "${config.indexName}" already exists. No action needed.`);
    return;
  }

  // Drop conflicting Prisma-generated unique indexes
  for (const conflicting of config.conflictingIndexNames) {
    if (indexNames.includes(conflicting)) {
      console.log(`  ⚠️  Found conflicting index "${conflicting}"`);
      if (!DRY_RUN) {
        await collection.dropIndex(conflicting);
        console.log(`  🗑️  Dropped index "${conflicting}"`);
      } else {
        console.log(`  [DRY RUN] Would drop index "${conflicting}"`);
      }
    }
  }

  // Create partial unique index
  if (!DRY_RUN) {
    try {
      await collection.createIndex(
        { [config.field]: 1 },
        {
          unique: true,
          name: config.indexName,
          partialFilterExpression: config.partialFilterExpression,
        }
      );
      console.log(`  ✅ Created partial unique index "${config.indexName}"`);
    } catch (err: any) {
      console.error(`  ❌ Failed to create index "${config.indexName}": ${err.message}`);
    }
  } else {
    console.log(`  [DRY RUN] Would create partial unique index "${config.indexName}"`);
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
