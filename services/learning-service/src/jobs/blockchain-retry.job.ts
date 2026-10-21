/**
 * Blockchain Retry Job
 * 
 * Periodically retries blockchain registration for certificates with
 * PENDING or FAILED blockchain status. Uses the same node-cron pattern
 * as study-reminder.job.ts.
 * 
 * Runs every 5 minutes. Only processes certificates when blockchain is enabled.
 */

import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { blockchainCertificateService } from '../services/blockchain-certificate.service';
import { CertificateService } from '../services/certificate.service';
import { CertificateMetadata, BlockchainMetadata } from '../types';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Start the blockchain retry cron job.
 * Runs every 5 minutes to retry PENDING/FAILED blockchain registrations.
 */
export function startBlockchainRetryJob() {
  if (!blockchainCertificateService.isEnabled()) {
    logger.info('⛓️  Blockchain retry job not started (blockchain disabled)');
    return;
  }

  cron.schedule('*/5 * * * *', async () => {
    try {
      await retryPendingRegistrations();
    } catch (error) {
      logger.error('⛓️  Blockchain retry job error:', error);
    }
  });

  logger.info('⛓️  Blockchain retry job initialized (runs every 5 minutes)');
}

/**
 * Find and retry certificates with PENDING or FAILED blockchain status.
 */
async function retryPendingRegistrations(): Promise<void> {
  // MongoDB Prisma doesn't support JSON path filters well.
  // Fetch recent certificates and filter in-memory.
  const recentCertificates = await prisma.certificate.findMany({
    where: {
      isVerified: true,
      metadata: { not: {} }, // has metadata
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Filter for PENDING or FAILED blockchain status
  const certificates = recentCertificates.filter(cert => {
    const meta = cert.metadata as any;
    return meta?.blockchain?.status === 'PENDING' || meta?.blockchain?.status === 'FAILED';
  }).slice(0, 10); // Process max 10 per cycle

  if (certificates.length === 0) return;

  logger.info(`⛓️  Retrying blockchain registration for ${certificates.length} certificate(s)...`);

  for (const certificate of certificates) {
    const metadata = certificate.metadata as CertificateMetadata;
    const blockchainMeta = metadata?.blockchain;

    if (!blockchainMeta || !blockchainMeta.documentHash) {
      logger.warn(`⛓️  Certificate ${certificate.certificateNumber} has invalid blockchain metadata, skipping`);
      continue;
    }

    try {
      const result = await blockchainCertificateService.registerCertificate(
        certificate.certificateNumber,
        blockchainMeta.documentHash,
        certificate.issueDate
      );

      if (result) {
        // Update metadata with confirmed transaction
        const updatedBlockchain: BlockchainMetadata = {
          ...blockchainMeta,
          transactionHash: result.transactionHash,
          status: 'CONFIRMED',
          registeredAt: new Date().toISOString(),
        };

        await prisma.certificate.update({
          where: { id: certificate.id },
          data: {
            metadata: {
              ...metadata,
              blockchain: updatedBlockchain as any,
            } as any,
          },
        });

        logger.info(`⛓️  Retry SUCCESS: ${certificate.certificateNumber} → ${result.transactionHash}`);
      } else {
        // Still failed — will retry on next cycle
        await CertificateService.updateBlockchainStatus(certificate.id, 'FAILED');
        logger.warn(`⛓️  Retry returned null for ${certificate.certificateNumber}`);
      }
    } catch (error: any) {
      await CertificateService.updateBlockchainStatus(certificate.id, 'FAILED');
      logger.error(`⛓️  Retry FAILED for ${certificate.certificateNumber}:`, error.message);
    }
  }
}
