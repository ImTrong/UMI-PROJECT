import { PayOS } from '@payos/node';
import logger from '../utils/logger';

/**
 * PayOS service - tích hợp thanh toán QR ngân hàng.
 * Sử dụng @payos/node v2.0.5.
 *
 * QUAN TRỌNG: payOS hiện tại chỉ có môi trường production,
 * không có sandbox riêng. Khi kiểm thử, dùng mock.
 * Chỉ phát sinh giao dịch tiền thật khi kiểm thử end-to-end.
 */

function isPlaceholder(value?: string): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  return (
    v.startsWith('your_') ||
    v.includes('placeholder') ||
    v === 'xxx' ||
    v === 'changeme'
  );
}

let payosInstance: PayOS | null = null;

function getPayOS(): PayOS {
  if (!payosInstance) {
    const clientId = process.env.PAYOS_CLIENT_ID;
    const apiKey = process.env.PAYOS_API_KEY;
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

    if (
      !clientId ||
      !apiKey ||
      !checksumKey ||
      isPlaceholder(clientId) ||
      isPlaceholder(apiKey) ||
      isPlaceholder(checksumKey)
    ) {
      throw new Error(
        'PayOS credentials not configured or using placeholder values. Set real PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY'
      );
    }

    payosInstance = new PayOS({
      clientId,
      apiKey,
      checksumKey,
      logLevel: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
    });
  }
  return payosInstance;
}

export interface CreatePayosLinkData {
  orderCode: number;
  amount: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  items?: Array<{ name: string; quantity: number; price: number }>;
}

export interface PayosWebhookData {
  orderCode: number;
  amount: number;
  description: string;
  accountNumber: string;
  reference: string;
  transactionDateTime: string;
  currency: string;
  paymentLinkId: string;
  code: string;
  desc: string;
  counterAccountBankId: string;
  counterAccountBankName: string;
  counterAccountName: string;
  counterAccountNumber: string;
  virtualAccountName: string;
  virtualAccountNumber: string;
}

export class PayosService {
  /**
   * Tạo payment link (bao gồm QR code).
   * @param data - Dữ liệu thanh toán (orderCode phải là số nguyên duy nhất)
   * @returns Payment link data bao gồm checkoutUrl và qrCode
   */
  static async createPaymentLink(data: CreatePayosLinkData) {
    const payos = getPayOS();

    try {
      const paymentLink = await payos.paymentRequests.create({
        orderCode: data.orderCode,
        amount: Math.round(data.amount), // VND, số nguyên
        description: data.description.substring(0, 25), // payOS max 25 chars
        returnUrl: data.returnUrl,
        cancelUrl: data.cancelUrl,
        items: data.items?.map(item => ({
          name: item.name.substring(0, 256),
          quantity: item.quantity,
          price: Math.round(item.price),
        })),
      });

      logger.info(`PayOS payment link created for orderCode: ${data.orderCode}`);
      return paymentLink;
    } catch (error: any) {
      logger.error('PayOS create payment link error:', error);
      throw new Error(`PayOS payment creation failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Xác minh webhook data từ payOS.
   * Kiểm tra chữ ký để đảm bảo tính toàn vẹn.
   */
  static async verifyWebhook(webhookBody: any): Promise<PayosWebhookData> {
    const payos = getPayOS();

    try {
      const verifiedData = await payos.webhooks.verify(webhookBody);
      logger.info(`PayOS webhook verified for orderCode: ${(verifiedData as any).orderCode}`);
      return verifiedData as unknown as PayosWebhookData;
    } catch (error: any) {
      logger.error('PayOS webhook verification failed:', error);
      throw new Error('PayOS webhook signature verification failed');
    }
  }

  /**
   * Lấy thông tin thanh toán theo orderCode.
   */
  static async getPaymentInfo(orderCode: number) {
    const payos = getPayOS();

    try {
      const info = await payos.paymentRequests.get(String(orderCode));
      logger.info(`PayOS payment info retrieved for orderCode: ${orderCode}`);
      return info;
    } catch (error: any) {
      logger.error('PayOS get payment info error:', error);
      throw new Error(`PayOS get payment info failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Hủy payment link.
   */
  static async cancelPaymentLink(orderCode: number, cancellationReason?: string) {
    const payos = getPayOS();

    try {
      const result = await payos.paymentRequests.cancel(String(orderCode), cancellationReason);
      logger.info(`PayOS payment link cancelled for orderCode: ${orderCode}`);
      return result;
    } catch (error: any) {
      logger.error('PayOS cancel payment link error:', error);
      throw new Error(`PayOS cancel failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Đăng ký webhook URL với payOS.
   */
  static async confirmWebhookUrl(webhookUrl: string) {
    const payos = getPayOS();

    try {
      const result = await payos.webhooks.confirm(webhookUrl);
      logger.info(`PayOS webhook confirmed: ${webhookUrl}`);
      return result;
    } catch (error: any) {
      logger.error('PayOS confirm webhook error:', error);
      throw new Error(`PayOS webhook confirmation failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Kiểm tra payOS đã được cấu hình chưa.
   */
  static isConfigured(): boolean {
    const clientId = process.env.PAYOS_CLIENT_ID;
    const apiKey = process.env.PAYOS_API_KEY;
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
    return !!(
      clientId &&
      apiKey &&
      checksumKey &&
      !isPlaceholder(clientId) &&
      !isPlaceholder(apiKey) &&
      !isPlaceholder(checksumKey)
    );
  }
}
