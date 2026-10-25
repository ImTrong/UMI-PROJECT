import { useCallback, useEffect, useState } from 'react';
import { FiDollarSign, FiShoppingBag, FiShoppingCart, FiBookOpen, FiRefreshCw, FiInfo } from 'react-icons/fi';
import { orderService, type SalesPerformance } from '../../services/order.service';
import { formatVND } from '../../utils/currency';
import {
  REVENUE_LABEL,
  buildQualityNotes,
  describeLoadError,
  describeName,
  describeRating,
} from '../../utils/sales-performance';

const formatCount = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

function RatingCell({ rating, count, reliable, minReviews }: { rating: number | null; count: number | null; reliable: boolean; minReviews: number }) {
  const d = describeRating(rating, count, reliable, minReviews);
  const missing = rating === null;
  return (
    <div>
      <span className={missing ? 'text-gray-400' : 'font-medium text-gray-900'}>{d.text}</span>
      {d.note && <div className="text-xs text-amber-600">{d.note}</div>}
    </div>
  );
}

/**
 * Sales and performance block of the admin dashboard (ADMIN-DASHBOARD-01): four KPI cards, then the top 5 courses and the top 5
 * instructors. It loads its own data (one request) so the rest of the dashboard does not wait for it.
 */
export default function SalesPerformanceSection() {
  const [data, setData] = useState<SalesPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await orderService.getSalesPerformance());
    } catch (e) {
      setData(null);
      setError(describeLoadError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="mb-10" aria-labelledby="sales-performance-title">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 id="sales-performance-title" className="text-2xl font-bold text-gray-900">Doanh số &amp; hiệu quả bán hàng</h2>
          <p className="text-sm text-gray-500">Chỉ tính các đơn có thanh toán thành công được xác nhận từ dịch vụ thanh toán.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
        >
          <FiRefreshCw className={loading ? 'animate-spin' : ''} /> Tải lại
        </button>
      </div>

      {loading && !data && (
        <div className="card flex items-center justify-center py-16" role="status" aria-live="polite">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
          <span className="ml-3 text-gray-500">Đang tải số liệu doanh số...</span>
        </div>
      )}

      {error && (
        <div className="card border border-red-200 bg-red-50" role="alert">
          <p className="font-semibold text-red-700">Không tải được số liệu doanh số</p>
          <p className="text-red-600 mt-1">{error}</p>
          <button type="button" onClick={load} className="mt-3 px-3 py-1 rounded bg-red-600 text-white text-sm hover:bg-red-700">Thử lại</button>
        </div>
      )}

      {data && <SalesPerformanceBody data={data} />}
    </section>
  );
}

function SalesPerformanceBody({ data }: { data: SalesPerformance }) {
  const { kpis, topCourses, topInstructors, dataQuality: dq } = data;
  const notes = buildQualityNotes(dq, formatVND);
  const noSales = kpis.paidOrderCount === 0 && kpis.soldCourseLineCount === 0;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-3">
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">{REVENUE_LABEL}</p>
              <p className="text-3xl font-bold mt-2 break-words">{formatVND(kpis.paidOrderAmount)}</p>
            </div>
            <FiDollarSign className="text-3xl text-primary-500 shrink-0" />
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Tổng giá trị các đơn đã thanh toán, chưa trừ hoàn tiền một phần chưa phân bổ theo khóa học nên chưa phải doanh thu thuần.
          </p>
        </div>

        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">Số khóa học đã bán</p>
              <p className="text-3xl font-bold mt-2">{formatCount(kpis.soldCourseLineCount)}</p>
            </div>
            <FiShoppingBag className="text-3xl text-primary-500 shrink-0" />
          </div>
          <p className="text-xs text-gray-500 mt-3">Số lượt bán hợp lệ (mỗi dòng khóa học của đơn đã thanh toán). Không tính mua trùng, đã hoàn, hay số lượt ghi danh.</p>
        </div>

        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">Số đơn đã thanh toán</p>
              <p className="text-3xl font-bold mt-2">{formatCount(kpis.paidOrderCount)}</p>
            </div>
            <FiShoppingCart className="text-3xl text-primary-500 shrink-0" />
          </div>
          <p className="text-xs text-gray-500 mt-3">Đếm đơn hàng, không đếm từng khóa học trong đơn.</p>
        </div>

        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">Khóa học có phát sinh bán hàng</p>
              <p className="text-3xl font-bold mt-2">{formatCount(kpis.distinctSoldCourseCount)}</p>
            </div>
            <FiBookOpen className="text-3xl text-primary-500 shrink-0" />
          </div>
          <p className="text-xs text-gray-500 mt-3">Số khóa học khác nhau có ít nhất một lượt bán hợp lệ.</p>
        </div>
      </div>

      {notes.length > 0 && (
        <details className="mb-8 text-sm text-gray-600">
          <summary className="cursor-pointer inline-flex items-center gap-2 text-primary-600">
            <FiInfo /> Lưu ý về số liệu ({notes.length})
          </summary>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </details>
      )}
      {notes.length === 0 && <div className="mb-8" />}

      {noSales && (
        <div className="card text-center text-gray-500 py-8 mb-8">
          Chưa có đơn hàng nào được xác nhận thanh toán thành công, nên chưa có số liệu để xếp hạng.
        </div>
      )}

      <div className="grid grid-cols-1 gap-8">
        <div className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="font-semibold text-lg">Top 5 khóa học hiệu quả</h3>
            <span className="text-xs text-gray-500">Xếp theo số lượt bán, bằng nhau thì theo tổng tiền · {topCourses.length}/{data.totalCoursesWithSales} khóa có bán</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm md:text-base">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-3 px-3">#</th>
                  <th className="py-3 px-3">Khóa học</th>
                  <th className="py-3 px-3">Giảng viên</th>
                  <th className="py-3 px-3 text-right">Lượt bán</th>
                  <th className="py-3 px-3 text-right">Tổng tiền bán hàng</th>
                  <th className="py-3 px-3">Đánh giá</th>
                </tr>
              </thead>
              <tbody>
                {topCourses.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-gray-500">Chưa có khóa học nào phát sinh lượt bán hợp lệ.</td></tr>
                )}
                {topCourses.map((c) => (
                  <tr key={c.courseId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3 font-semibold">{c.rank}</td>
                    <td className="py-3 px-3 font-medium">{c.courseTitle || 'Chưa có thông tin'}</td>
                    <td className={`py-3 px-3 ${c.instructorName ? '' : 'text-gray-400'}`}>{describeName(c.instructorName)}</td>
                    <td className="py-3 px-3 text-right font-semibold">{formatCount(c.salesCount)}</td>
                    <td className="py-3 px-3 text-right">{formatVND(c.salesAmount)}</td>
                    <td className="py-3 px-3">
                      <RatingCell rating={c.rating} count={c.ratingCount} reliable={c.ratingReliable} minReviews={dq.minReliableReviews} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <h3 className="font-semibold text-lg">Top 5 giảng viên hiệu quả</h3>
            <span className="text-xs text-gray-500">Tổng hợp từ các khóa học có bán · {topInstructors.length}/{data.totalInstructorsWithSales} giảng viên có bán</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Thứ hạng chỉ là căn cứ tham khảo để cân nhắc hợp tác; hãy xem cùng số lượt bán, số khóa và đánh giá, không dùng thứ hạng để tự quyết định.
            Điểm đánh giá là trung bình theo số lượt đánh giá của các khóa học có bán.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm md:text-base">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-3 px-3">#</th>
                  <th className="py-3 px-3">Giảng viên</th>
                  <th className="py-3 px-3 text-right">Khóa học có bán</th>
                  <th className="py-3 px-3 text-right">Tổng lượt bán</th>
                  <th className="py-3 px-3 text-right">Tổng tiền bán hàng</th>
                  <th className="py-3 px-3">Đánh giá</th>
                </tr>
              </thead>
              <tbody>
                {topInstructors.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-gray-500">Chưa có giảng viên nào phát sinh lượt bán hợp lệ.</td></tr>
                )}
                {topInstructors.map((i) => (
                  <tr key={i.instructorId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3 font-semibold">{i.rank}</td>
                    <td className={`py-3 px-3 font-medium ${i.instructorName ? '' : 'text-gray-400'}`}>{describeName(i.instructorName)}</td>
                    <td className="py-3 px-3 text-right">{formatCount(i.soldCourseCount)}</td>
                    <td className="py-3 px-3 text-right font-semibold">{formatCount(i.salesCount)}</td>
                    <td className="py-3 px-3 text-right">{formatVND(i.salesAmount)}</td>
                    <td className="py-3 px-3">
                      <RatingCell rating={i.rating} count={i.ratingCount} reliable={i.ratingReliable} minReviews={dq.minReliableReviews} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
