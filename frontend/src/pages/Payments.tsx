import { useState, useEffect } from 'react';
import { paymentService, Payment } from '../services/payment.service';
import { PaymentCard } from '../components/payment/PaymentCard';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiCreditCard, FiFilter } from 'react-icons/fi';

export default function Payments() {
  const { isAuthenticated } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasPrevPage: false,
    hasNextPage: false,
  });
  const [statusFilter, setStatusFilter] = useState<Payment['status'] | ''>('');
  const [showFilters, setShowFilters] = useState(false);

  const loadPayments = async (page: number = 1) => {
    setLoading(true);
    try {
      const result = await paymentService.getUserPayments(page, 10);
      setPayments(result.payments);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to load payments:', error);
      toast.error('Failed to load payment history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadPayments();
    }
  }, [isAuthenticated]);

  const handleRefund = async (paymentId: string) => {
    const amount = prompt('Enter amount to refund (leave empty for full refund):');
    const reason = prompt('Reason for refund:');
    
    try {
      await paymentService.refundPayment(
        paymentId,
        amount ? parseFloat(amount) : undefined,
        reason || undefined
      );
      toast.success('Refund processed successfully');
      loadPayments(pagination.page);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to process refund');
    }
  };

  if (loading && payments.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Payment History</h1>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center space-x-2 text-gray-600 hover:text-gray-800"
        >
          <FiFilter />
          <span>Filter</span>
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="card mb-6">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Payment['status'] | '')}
            className="input-field"
          >
            <option value="">All Status</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="PENDING">Pending</option>
            <option value="PROCESSING">Processing</option>
            <option value="FAILED">Failed</option>
            <option value="REFUNDED">Refunded</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      )}

      {payments.length === 0 ? (
        <div className="card text-center py-12">
          <FiCreditCard className="mx-auto text-4xl text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No payments yet</h2>
          <p className="text-gray-600">Your payment history will appear here.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {payments
              .filter(p => !statusFilter || p.status === statusFilter)
              .map((payment) => (
                <PaymentCard
                  key={payment.id}
                  payment={payment}
                  onRefund={payment.status === 'SUCCEEDED' ? handleRefund : undefined}
                />
              ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center space-x-2 mt-8">
              <button
                onClick={() => loadPayments(pagination.page - 1)}
                disabled={!pagination.hasPrevPage}
                className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="px-3 py-1">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => loadPayments(pagination.page + 1)}
                disabled={!pagination.hasNextPage}
                className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
