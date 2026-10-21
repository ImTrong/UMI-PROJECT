import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

import dotenv from 'dotenv';
dotenv.config();

const rawUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
if (!rawUrl) {
  throw new Error('DATABASE_URL or TEST_DATABASE_URL environment variable must be provided.');
}
const dbUrl = rawUrl.includes('mongodb:27017')
  ? rawUrl.replace('mongodb:27017', 'localhost:27017') + (rawUrl.includes('directConnection') ? '' : '&directConnection=true')
  : rawUrl;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
});

export async function runControlledBackfill() {
  console.log('=== STARTING CONTROLLED OUTBOX BACKFILL ===');
  
  // Find all payments where orderSynced is not a boolean (is null or not set)
  const candidatePayments = await prisma.payment.findMany({
    where: {
      OR: [
        { orderSynced: null },
        { orderSynced: { isSet: false } },
      ],
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      status: true,
      metadata: true,
      updatedAt: true,
    },
  });

  console.log(`Found ${candidatePayments.length} payments requiring backfill.`);

  let syncedBackfilled = 0;
  let unsyncedBackfilled = 0;

  for (const payment of candidatePayments) {
    const meta = (payment.metadata as any) || {};
    const historicalSynced = meta.orderSynced === true;

    if (historicalSynced) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          orderSynced: true,
          orderSyncedAt: meta.orderSyncedAt ? new Date(meta.orderSyncedAt) : payment.updatedAt,
        },
      });
      syncedBackfilled++;
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          orderSynced: false,
        },
      });
      unsyncedBackfilled++;
    }
  }

  console.log(`=== BACKFILL COMPLETED ===`);
  console.log(` - Historical synced records marked orderSynced=true: ${syncedBackfilled}`);
  console.log(` - Unsynced records marked orderSynced=false: ${unsyncedBackfilled}`);
  console.log(` - Total backfilled: ${candidatePayments.length}`);

  return { total: candidatePayments.length, syncedBackfilled, unsyncedBackfilled };
}

if (require.main === module) {
  runControlledBackfill()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('Backfill error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
