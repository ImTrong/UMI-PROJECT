/**
 * ADMIN-DASHBOARD-01 - wording of the sales section of the admin dashboard (pure functions, so they can be unit-tested).
 * Nothing here computes a figure: the numbers come from GET /api/orders/analytics/sales-performance. These helpers only decide what
 * to SAY when a value is missing, unknown or not reliable - never a guess.
 */
import type { SalesPerformance } from '../services/order.service';

export const REVENUE_LABEL = 'Tổng tiền đơn đã thanh toán (trước điều chỉnh hoàn tiền chưa phân bổ)';
export const NO_DATA = 'Chưa có dữ liệu';

export interface RatingText {
  /** main text of the cell */
  text: string;
  /** short remark under it, '' when none */
  note: string;
}

/** rating / count follow the API: count null = unknown, 0 = known to have no review; rating null = nothing to average. */
export function describeRating(rating: number | null, count: number | null, reliable: boolean, minReviews: number): RatingText {
  if (count === null) return { text: NO_DATA, note: '' };
  if (rating === null || count === 0) return { text: 'Chưa có đánh giá', note: '' };
  return {
    text: `${rating.toFixed(2)} ★ (${count} lượt đánh giá)`,
    note: reliable ? '' : `Ít đánh giá (dưới ${minReviews}) - chưa đủ tin cậy`,
  };
}

/** A name the user-service did not give is shown as missing; it is not rebuilt from an id. */
export function describeName(name: string | null | undefined): string {
  return name && name.trim() ? name : 'Chưa có thông tin';
}

/** Why the section could not load, in words for the admin. */
export function describeLoadError(error: any): string {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  if (code === 'PAYMENT_EVIDENCE_UNAVAILABLE') {
    return 'Chưa xác minh được trạng thái thanh toán từ dịch vụ thanh toán nên không hiển thị số liệu (hệ thống không dùng trạng thái đơn hàng để thay thế).';
  }
  if (status === 401 || status === 403) return 'Bạn không có quyền xem số liệu doanh số.';
  if (!error?.response) return 'Không kết nối được máy chủ. Vui lòng thử lại.';
  return 'Không tải được số liệu doanh số. Vui lòng thử lại.';
}

/** The short remarks under the KPIs / tables: only what applies to the current data. */
export function buildQualityNotes(dq: SalesPerformance['dataQuality'], formatMoney: (n: number) => string): string[] {
  const notes: string[] = [];
  if (dq.ordersWithoutPaymentEvidence > 0) {
    notes.push(`${dq.ordersWithoutPaymentEvidence} đơn được ghi nhận đã thanh toán/hoàn thành ở phía đơn hàng nhưng không có thanh toán thành công tương ứng (ví dụ admin cập nhật thủ công): không tính vào doanh số.`);
  }
  if (dq.ordersPaymentNotRecordedByOrder > 0) {
    notes.push(`${dq.ordersPaymentNotRecordedByOrder} đơn có thanh toán thành công nhưng đơn hàng chưa ghi nhận: chưa tính vào doanh số cho tới khi được đồng bộ.`);
  }
  if (dq.fullyRefundedOrders.count > 0) {
    notes.push(`${dq.fullyRefundedOrders.count} đơn đã hoàn tiền toàn bộ (${formatMoney(dq.fullyRefundedOrders.amount)}): không tính vào doanh số.`);
  }
  if (dq.partiallyRefundedOrders.count > 0) {
    notes.push(`${dq.partiallyRefundedOrders.count} đơn tính trong doanh số đã được hoàn tiền một phần (tổng ${formatMoney(dq.partiallyRefundedOrders.refundedAmount)}, gồm cả hoàn cho dòng mua trùng); khoản này chưa được phân bổ theo từng khóa học nên chưa trừ.`);
  }
  if (dq.duplicateLines.count > 0) {
    notes.push(`${dq.duplicateLines.count} dòng mua trùng khóa đã sở hữu (${formatMoney(dq.duplicateLines.amount)}): không tính là lượt bán.`);
  }
  if (dq.refundedLines.count > 0) {
    notes.push(`${dq.refundedLines.count} dòng khóa học đã hoàn tiền: không tính là lượt bán.`);
  }
  if (dq.unclassifiedLines.count > 0) {
    notes.push(`${dq.unclassifiedLines.count} dòng khóa học của đơn đã thanh toán chưa có trạng thái cấp quyền rõ ràng: không tính là lượt bán.`);
  }
  if (dq.soldLinesWithoutInstructor > 0) {
    notes.push(`${dq.soldLinesWithoutInstructor} lượt bán chưa xác định được giảng viên: có trong Top khóa học, không có trong Top giảng viên.`);
  }
  if (!dq.courseInfoAvailable) notes.push('Không lấy được thông tin khóa học từ dịch vụ khóa học: điểm đánh giá hiển thị "Chưa có dữ liệu".');
  if (!dq.instructorInfoAvailable) notes.push('Không lấy được tên giảng viên từ dịch vụ người dùng.');
  return notes;
}
