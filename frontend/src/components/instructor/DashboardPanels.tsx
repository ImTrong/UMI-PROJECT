import { FiBookOpen, FiCheckCircle, FiClock, FiXCircle, FiStar, FiAlertTriangle } from 'react-icons/fi';
import type { Course, InstructorDashboardStats } from '../../services/course.service';

/**
 * IMPLEMENT-02 - presentational pieces of the Instructor Dashboard. Every KPI comes from the course-service dashboard API as is
 * (nothing is re-computed from the course list); no revenue, earnings or learner count is shown - the data for those does not
 * exist yet (Course.enrolledCount counts paid enrollments only, never unique learners).
 */

export type CourseStatus = { key: 'PUBLISHED' | 'PENDING_REVIEW' | 'REJECTED' | 'DRAFT'; label: string; className: string };

export function courseStatus(course: Pick<Course, 'published' | 'approvalStatus'>): CourseStatus {
  if (course.published) return { key: 'PUBLISHED', label: 'Đã xuất bản', className: 'bg-green-100 text-green-700' };
  if (course.approvalStatus === 'PENDING_REVIEW') return { key: 'PENDING_REVIEW', label: 'Chờ duyệt', className: 'bg-cyan-100 text-cyan-700' };
  if (course.approvalStatus === 'REJECTED') return { key: 'REJECTED', label: 'Bị từ chối', className: 'bg-red-100 text-red-700' };
  return { key: 'DRAFT', label: 'Bản nháp', className: 'bg-yellow-100 text-yellow-700' };
}

/** Things the instructor has to act on, from data the list API really returns. */
export function courseTodos(course: Pick<Course, 'published' | 'approvalStatus' | 'rejectionReason' | '_count'>): string[] {
  const todos: string[] = [];
  if (!course.published && course.approvalStatus === 'REJECTED') {
    todos.push(course.rejectionReason?.trim() ? `Bị từ chối: ${course.rejectionReason.trim()}` : 'Bị từ chối (không có lý do kèm theo)');
  }
  if (course._count && course._count.lessons === 0) todos.push('Chưa có bài học - cần ít nhất một bài học để gửi duyệt');
  return todos;
}

export function formatRating(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

type Kpi = { key: string; label: string; value: string; hint?: string; icon: typeof FiBookOpen; iconClass: string };

export function dashboardKpis(stats: InstructorDashboardStats): Kpi[] {
  return [
    { key: 'total', label: 'Tổng số khóa học', value: String(stats.totalCourses), icon: FiBookOpen, iconClass: 'text-primary-500' },
    { key: 'published', label: 'Đã xuất bản', value: String(stats.publishedCourses), icon: FiCheckCircle, iconClass: 'text-green-500' },
    { key: 'pending', label: 'Chờ duyệt', value: String(stats.pendingCourses), icon: FiClock, iconClass: 'text-cyan-500' },
    { key: 'rejected', label: 'Bị từ chối', value: String(stats.rejectedCourses), icon: FiXCircle, iconClass: 'text-red-500' },
    {
      key: 'rating',
      label: 'Đánh giá trung bình',
      value: stats.totalReviews > 0 ? formatRating(stats.averageRating) : '—',
      hint: stats.totalReviews > 0 ? `Trên ${stats.totalReviews} lượt đánh giá (tính theo số lượt đánh giá)` : 'Chưa có lượt đánh giá nào',
      icon: FiStar,
      iconClass: 'text-yellow-500',
    },
  ];
}

export function DashboardKpis({ stats, error, loading, onRetry }: {
  stats: InstructorDashboardStats | null;
  error?: string | null;
  loading?: boolean;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="card mb-8 flex justify-center py-8" data-testid="kpi-loading">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }
  if (error || !stats) {
    return (
      <div className="card mb-8 bg-red-50 border border-red-100 flex items-center justify-between" data-testid="kpi-error">
        <p className="text-sm text-red-700">{error || 'Không tải được số liệu tổng quan.'}</p>
        {onRetry && <button onClick={onRetry} className="text-sm font-medium text-red-700 underline">Thử lại</button>}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8" data-testid="kpi-cards">
      {dashboardKpis(stats).map((kpi) => (
        <div key={kpi.key} className="card" data-kpi={kpi.key}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">{kpi.label}</p>
              <p className="text-2xl font-bold">{kpi.value}</p>
              {kpi.hint && <span className="text-xs text-slate-400 block mt-1">{kpi.hint}</span>}
            </div>
            <kpi.icon className={`text-3xl ${kpi.iconClass}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CourseStatusBadge({ course }: { course: Pick<Course, 'published' | 'approvalStatus'> }) {
  const status = courseStatus(course);
  return <span className={`text-xs px-2 py-1 rounded-full ${status.className}`}>{status.label}</span>;
}

export function CourseTodoNotes({ course }: { course: Pick<Course, 'published' | 'approvalStatus' | 'rejectionReason' | '_count'> }) {
  const todos = courseTodos(course);
  if (todos.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5" data-testid="course-todos">
      {todos.map((todo) => (
        <li key={todo} className="text-xs text-amber-700 flex items-start">
          <FiAlertTriangle className="mr-1 mt-0.5 flex-shrink-0" size={12} />
          <span>{todo}</span>
        </li>
      ))}
    </ul>
  );
}
