import { FiClock } from 'react-icons/fi';

/**
 * Shown when a confirmation answered "still processing" or could not be verified (FIX 07B-1.3): it never says the purchase succeeded.
 * The checkout page keeps polling the order, which only the payment webhook / outbox moves to PAID.
 */
export const PaymentPendingNotice = ({ message }: { message: string }) => (
  <div role="status" data-outcome="pending" className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
    <FiClock className="mt-0.5 shrink-0" />
    <div>
      <p className="font-semibold">Đang chờ xác nhận thanh toán</p>
      <p>{message}</p>
    </div>
  </div>
);
