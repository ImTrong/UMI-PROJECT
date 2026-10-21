/**
 * C1: Migration Script — payosOrderCode Int (BSON int32/int64/double) → String
 *
 * Converts existing payosOrderCode values from numeric BSON types to String
 * in both 'payments' and 'orders' collections.
 *
 * Features:
 * - DRY_RUN mode: preview changes without writing
 * - Statistics: counts by type before and after
 * - Conflict detection: checks for duplicate values after conversion
 * - Safe: does not delete any records
 *
 * Usage:
 *   DRY_RUN=true  npx ts-node scripts/migrate-payos-ordercode.ts   (preview)
 *   DRY_RUN=false npx ts-node scripts/migrate-payos-ordercode.ts   (execute)
 */
import dotenv from 'dotenv';
dotenv.config();

const { MongoClient } = require('mongodb');

const DRY_RUN = (process.env.DRY_RUN || 'true').toLowerCase() === 'true';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  const urlObj = new URL(dbUrl);
  const dbName = urlObj.pathname.replace(/^\//, '').split('?')[0] || 'elearning';

  const client = new MongoClient(dbUrl);
  await client.connect();
  const db = client.db(dbName);

  console.log(`\n====== payosOrderCode Migration: Int → String ======`);
  console.log(`Database: ${dbName}`);
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🔧 EXECUTE'}\n`);

  await migrateCollection(db, 'payments');
  await migrateCollection(db, 'orders');

  console.log('\n====== Migration Complete ======\n');
  await client.close();
}

async function migrateCollection(db: any, collectionName: string) {
  const collection = db.collection(collectionName);

  console.log(`\n--- ${collectionName} ---`);

  // 1. Statistics: count by BSON type
  const typeStats = await collection.aggregate([
    { $match: { payosOrderCode: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: { $type: '$payosOrderCode' },
        count: { $sum: 1 },
      },
    },
  ]).toArray();

  console.log('  Current type distribution:');
  let totalWithValue = 0;
  for (const stat of typeStats) {
    console.log(`    ${stat._id}: ${stat.count} documents`);
    totalWithValue += stat.count;
  }

  const totalNull = await collection.countDocuments({
    $or: [
      { payosOrderCode: null },
      { payosOrderCode: { $exists: false } },
    ],
  });
  console.log(`    null/missing: ${totalNull} documents`);
  console.log(`    Total with value: ${totalWithValue}`);

  if (totalWithValue === 0) {
    console.log('  ✅ No records to migrate.');
    return;
  }

  // 2. Find all numeric payosOrderCode values
  const numericDocs = await collection.find({
    payosOrderCode: { $exists: true, $ne: null },
    $expr: { $ne: [{ $type: '$payosOrderCode' }, 'string'] },
  }).project({ _id: 1, payosOrderCode: 1 }).toArray();

  console.log(`  Records needing conversion (non-string): ${numericDocs.length}`);

  if (numericDocs.length === 0) {
    console.log('  ✅ All payosOrderCode values are already strings.');
    return;
  }

  // 3. Check for conflicts after conversion
  const stringValues = numericDocs.map((d: any) => String(d.payosOrderCode));
  const existingStrings = await collection.find({
    payosOrderCode: { $type: 'string' },
  }).project({ payosOrderCode: 1 }).toArray();

  const existingStringValues = new Set(existingStrings.map((d: any) => d.payosOrderCode));
  const conflicts = stringValues.filter((v: string) => existingStringValues.has(v));

  if (conflicts.length > 0) {
    console.log(`  ⚠️  ${conflicts.length} CONFLICTS detected (numeric value already exists as string):`);
    for (const c of conflicts.slice(0, 10)) {
      console.log(`    - "${c}"`);
    }
    console.log('  ❌ ABORTING migration for this collection. Resolve conflicts manually.');
    return;
  }

  // 4. Check for duplicate numeric values
  const valueCount = new Map<string, number>();
  for (const v of stringValues) {
    valueCount.set(v, (valueCount.get(v) || 0) + 1);
  }
  const duplicates = [...valueCount.entries()].filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    console.log(`  ⚠️  ${duplicates.length} duplicate payosOrderCode values found:`);
    for (const [val, count] of duplicates.slice(0, 10)) {
      console.log(`    - "${val}" appears ${count} times`);
    }
    console.log('  ❌ ABORTING migration for this collection. Resolve duplicates manually.');
    return;
  }

  // 5. Perform migration
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would convert ${numericDocs.length} records from numeric to string`);
    console.log('  Sample conversions:');
    for (const doc of numericDocs.slice(0, 5)) {
      console.log(`    ${doc._id}: ${doc.payosOrderCode} (${typeof doc.payosOrderCode}) → "${String(doc.payosOrderCode)}"`);
    }
  } else {
    let converted = 0;
    let errors = 0;

    for (const doc of numericDocs) {
      try {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { payosOrderCode: String(doc.payosOrderCode) } }
        );
        converted++;
      } catch (err: any) {
        console.error(`    ❌ Failed to convert ${doc._id}: ${err.message}`);
        errors++;
      }
    }

    console.log(`  ✅ Converted: ${converted} records`);
    if (errors > 0) {
      console.log(`  ❌ Errors: ${errors} records`);
    }

    // 6. Verify
    const postStats = await collection.aggregate([
      { $match: { payosOrderCode: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: { $type: '$payosOrderCode' },
          count: { $sum: 1 },
        },
      },
    ]).toArray();

    console.log('  Post-migration type distribution:');
    for (const stat of postStats) {
      console.log(`    ${stat._id}: ${stat.count} documents`);
    }
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
