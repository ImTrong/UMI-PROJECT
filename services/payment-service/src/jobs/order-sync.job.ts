import { PrismaClient, PaymentStatus } from '@prisma/client';
import axios from 'axios';
import logger from '../utils/logger';
import { checkServiceToken, readServiceToken, SERVICE_TOKEN_HEADER } from '../utils/service-token';

const defaultPrisma = new PrismaClient();

export interface OrderSyncOptions {
  prismaClient?: any;
  axiosInstance?: any;
  pageSize?: number;
  maxPages?: number;
  orderServiceUrl?: string;
  internalToken?: string;
  ignoreConcurrencyLock?: boolean;
}

export interface SyncResult {
  processed: number;
  succeeded: number;
  failed: number;
  skippedBackoff: number;
  skippedLocked?: number;
}

let isJobRunning = false;

/**
 * Tính toán thời gian backoff theo số lần thử thất bại (exponential/progressive backoff).
 * Không bao giờ bỏ cuộc vĩnh viễn (cap tối đa 1 giờ để định kỳ kiểm tra lại).
 */
export function calculateBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  if (attempts <= 3) return 30 * 1000;          // 30 giây
  if (attempts <= 6) return 2 * 60 * 1000;      // 2 phút
  if (attempts <= 9) return 10 * 60 * 1000;     // 10 phút
  if (attempts <= 14) return 30 * 60 * 1000;    // 30 phút
  return 60 * 60 * 1000;                        // Tối đa 1 giờ cho các lần thử >= 15
}

/**
 * Kiểm tra xem giao dịch có đang trong thời gian backoff chờ thử lại hay không.
 */
export function isBackoffActive(meta: any, now: number = Date.now()): boolean {
  const attempts = meta?.syncAttempts || 0;
  if (attempts <= 0 || !meta?.lastSyncAttemptAt) return false;
  const lastAttemptTime = new Date(meta.lastSyncAttemptAt).getTime();
  const requiredBackoff = calculateBackoffMs(attempts);
  return (now - lastAttemptTime) < requiredBackoff;
}

/**
 * Quét TOÀN BỘ các Payment SUCCEEDED còn `orderSynced !== true` (loại bỏ hoàn toàn giới hạn 14 ngày).
 * Sử dụng trường riêng `orderSynced` tương thích native với MongoDB/Prisma (tránh lọc JSON lồng nhau).
 * Bảo toàn và tự động đồng bộ lại dữ liệu cũ nếu phát hiện thiếu thông tin.
 * Tích hợp khóa chống trùng lặp (in-memory lock + distributed syncLockUntil),
 * cursor pagination, progressive backoff và cảnh báo đa cấp.
 */
export async function syncPendingOrders(options: OrderSyncOptions = {}): Promise<SyncResult> {
  // The order webhook accepts only the Order <-> Payment credential (FIX 07B-2A). Without a usable one nothing is sent and nothing
  // is counted as an attempt: the payments stay orderSynced=false and the next run delivers them once the token is configured.
  const token = options.internalToken !== undefined
    ? checkServiceToken('ORDER_PAYMENT_TOKEN', options.internalToken)
    : readServiceToken('ORDER_PAYMENT_TOKEN');
  if (!token.ok) {
    logger.error(`[OutboxJob] Order sync not run: ${token.reason}`);
    return { processed: 0, succeeded: 0, failed: 0, skippedBackoff: 0, skippedLocked: 0 };
  }

  if (isJobRunning && !options.ignoreConcurrencyLock) {
    logger.info('[OutboxJob] Previous sync job still in progress, skipping overlapping execution.');
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skippedBackoff: 0,
      skippedLocked: 0,
    };
  }

  isJobRunning = true;

  const prisma = options.prismaClient || defaultPrisma;
  const clientAxios = options.axiosInstance || axios;
  const pageSize = options.pageSize || 50;
  const maxPages = options.maxPages || 20; // Tối đa 1,000 bản ghi mỗi lượt quét
  const orderServiceUrl = options.orderServiceUrl || process.env.ORDER_SERVICE_URL || 'http://localhost:3004';

  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalSkippedBackoff = 0;
  let totalSkippedLocked = 0;
  let cursorId: string | undefined = undefined;

  try {
    const now = Date.now();

    // Phân trang duyệt qua các Payment SUCCEEDED có orderId và orderSynced !== true
    // Truy vấn tương thích 100% với MongoDB Prisma connector (không dùng nested JSON filtering)
    for (let page = 0; page < maxPages; page++) {
      const queryArgs: any = {
        where: {
          status: PaymentStatus.SUCCEEDED,
          orderId: { not: null },
          OR: [
            { orderSynced: false },
            { orderSynced: null },
            { orderSynced: { isSet: false } },
          ],
        },
        orderBy: { id: 'asc' }, // Xử lý tuần tự các giao dịch từ cũ nhất
        take: pageSize,
      };

      if (cursorId) {
        queryArgs.where.id = { gt: cursorId };
      }

      const paymentsBatch = await prisma.payment.findMany(queryArgs);
      if (!paymentsBatch || paymentsBatch.length === 0) {
        break; // Không còn dữ liệu để duyệt
      }

      cursorId = paymentsBatch[paymentsBatch.length - 1].id;

      for (const payment of paymentsBatch) {
        const meta = (payment.metadata as any) || {};

        // Kiểm tra tính tương thích ngược với dữ liệu cũ (đã từng sync lưu trong metadata)
        const isAlreadySynced = payment.orderSynced === true || meta.orderSynced === true;
        if (!payment.orderId || isAlreadySynced) {
          // Self-heal: Nếu metadata đã đánh dấu synced mà root field chưa có, cập nhật luôn root field
          if (isAlreadySynced && payment.orderSynced !== true) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                orderSynced: true,
                orderSyncedAt: meta.orderSyncedAt ? new Date(meta.orderSyncedAt) : new Date(),
                syncLockUntil: null,
              },
            }).catch(() => {});
          }
          continue;
        }

        // Kiểm tra distributed lock: Nếu worker khác đang xử lý (lock còn hiệu lực), bỏ qua
        if (payment.syncLockUntil && new Date(payment.syncLockUntil).getTime() > now) {
          totalSkippedLocked++;
          continue;
        }

        // Kiểm tra cơ chế backoff nếu đã từng thử và thất bại trước đó
        const attempts = payment.syncAttempts ?? meta.syncAttempts ?? 0;
        const lastAttemptAt = payment.lastSyncAttemptAt ?? meta.lastSyncAttemptAt;
        if (isBackoffActive({ syncAttempts: attempts, lastSyncAttemptAt: lastAttemptAt }, now)) {
          totalSkippedBackoff++;
          continue;
        }

        totalProcessed++;
        const currentAttempts = attempts + 1;

        // Chiếm distributed lock (60 giây) trước khi gọi downstream
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            syncLockUntil: new Date(now + 60000),
          },
        }).catch(() => {});

        try {
          // Gọi sang order-service để đồng bộ trạng thái đơn hàng
          await clientAxios.post(
            `${orderServiceUrl}/api/orders/webhook/payment`,
            { orderId: payment.orderId, status: 'PAID' },
            { headers: { [SERVICE_TOKEN_HEADER]: token.value }, timeout: 5000 }
          );

          const syncedAt = new Date();
          // Cập nhật cả trường riêng và metadata để đảm bảo bảo toàn dữ liệu & tương thích ngược
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              orderSynced: true,
              orderSyncedAt: syncedAt,
              syncLockUntil: null,
              lastSyncError: null,
              metadata: {
                ...meta,
                orderSynced: true,
                orderSyncedAt: syncedAt,
                syncSource: 'OUTBOX_ORDER_SYNC_JOB',
                lastSyncError: null,
                persistentFailureAlert: false,
              },
            },
          });

          totalSucceeded++;
          if (attempts > 0) {
            logger.info(
              `[OutboxJob] Successfully synced order ${payment.orderId} for payment ${payment.id} after ${attempts} prior failed attempts.`
            );
          } else {
            logger.info(`[OutboxJob] Successfully synced order ${payment.orderId} for payment ${payment.id}`);
          }
        } catch (err: any) {
          totalFailed++;
          const errorMessage = err.response?.data?.error || err.message || 'Unknown network error';
          const isPersistentAlert = currentAttempts >= 5;
          const isCriticalAlert = currentAttempts >= 10;
          const attemptTime = new Date();

          // Cập nhật thông tin thất bại, xóa syncLockUntil để lượt sau retry theo backoff
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              syncAttempts: currentAttempts,
              lastSyncAttemptAt: attemptTime,
              lastSyncError: errorMessage,
              syncLockUntil: null,
              metadata: {
                ...meta,
                syncAttempts: currentAttempts,
                lastSyncAttemptAt: attemptTime,
                lastSyncError: errorMessage,
                firstSyncFailedAt: meta.firstSyncFailedAt || attemptTime,
                persistentFailureAlert: isPersistentAlert,
              },
            },
          }).catch((dbErr: any) => logger.error('[OutboxJob] Failed updating sync metadata:', dbErr));

          // Cảnh báo theo cấp độ khi lỗi kéo dài
          if (isCriticalAlert) {
            logger.error(
              `[OutboxJob][CRITICAL_ALERT] Severe order sync failure! Payment ${payment.id} (orderId: ${payment.orderId}) has failed ${currentAttempts} consecutive times over a long period. Immediate admin intervention required! Last error: ${errorMessage}`
            );
          } else if (isPersistentAlert) {
            logger.warn(
              `[OutboxJob][ALERT] Persistent order sync failure for payment ${payment.id} (orderId: ${payment.orderId}). Attempt #${currentAttempts} failed. Backoff scheduled. Last error: ${errorMessage}`
            );
          } else {
            logger.warn(
              `[OutboxJob] Failed attempt #${currentAttempts} to sync order ${payment.orderId} for payment ${payment.id}: ${errorMessage}`
            );
          }
        }
      }

      // Nếu số bản ghi trả về nhỏ hơn pageSize, đã hết danh sách
      if (paymentsBatch.length < pageSize) {
        break;
      }
    }

    if (totalProcessed > 0 || totalSkippedBackoff > 0 || totalSkippedLocked > 0) {
      logger.info(
        `[OutboxJob] Sweep finished: ${totalSucceeded} succeeded, ${totalFailed} failed, ${totalSkippedBackoff} in backoff, ${totalSkippedLocked} locked (processed ${totalProcessed} total)`
      );
    }

    return {
      processed: totalProcessed,
      succeeded: totalSucceeded,
      failed: totalFailed,
      skippedBackoff: totalSkippedBackoff,
      skippedLocked: totalSkippedLocked,
    };
  } catch (error: any) {
    logger.error('[OutboxJob] Fatal error running syncPendingOrders:', error);
    return {
      processed: totalProcessed,
      succeeded: totalSucceeded,
      failed: totalFailed,
      skippedBackoff: totalSkippedBackoff,
      skippedLocked: totalSkippedLocked,
    };
  } finally {
    isJobRunning = false;
  }
}

let syncIntervalTimer: NodeJS.Timeout | null = null;

export function startOrderSyncJob(intervalMs: number = 30000) {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
  }

  // Chạy ngay lần đầu sau 5 giây khởi động
  setTimeout(() => {
    syncPendingOrders().catch((e) => logger.error('[OutboxJob] Initial sync error:', e));
  }, 5000);

  // Lặp lại theo chu kỳ (mặc định 30s)
  syncIntervalTimer = setInterval(() => {
    syncPendingOrders().catch((e) => logger.error('[OutboxJob] Interval sync error:', e));
  }, intervalMs);

  logger.info(`[OutboxJob] Background Order Sync Job started (interval: ${intervalMs}ms)`);
}

export function stopOrderSyncJob() {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
    syncIntervalTimer = null;
    logger.info('[OutboxJob] Background Order Sync Job stopped');
  }
}
