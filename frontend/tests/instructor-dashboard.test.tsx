/**
 * IMPLEMENT-02: the Instructor Dashboard shows the course-service KPIs as they come (GET /api/courses/instructor/dashboard) and
 * no revenue / earnings / learner figure; the course list (GET /api/courses/me) only feeds the management table, with each
 * course's status, rejection reason and a "no lesson yet" warning.
 *
 * The HTTP layer is the project's own axios instance with a recording adapter; the panels are rendered to static markup.
 *
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { courseApi } from '../src/services/api';
import { courseService, InstructorDashboardStats } from '../src/services/course.service';
import {
  DashboardKpis, CourseTodoNotes, CourseStatusBadge, courseStatus, courseTodos, dashboardKpis,
} from '../src/components/instructor/DashboardPanels';

(globalThis as any).localStorage = { getItem: () => 'test-access-token', setItem: () => undefined, removeItem: () => undefined };
const PAGE = path.join(process.cwd(), 'src', 'pages', 'InstructorDashboard.tsx');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const stats = (over: Partial<InstructorDashboardStats> = {}): InstructorDashboardStats => ({
  totalCourses: 6, publishedCourses: 3, pendingCourses: 1, rejectedCourses: 1, totalEnrolled: 250, totalReviews: 30, averageRating: 1.13,
  // per-course ratings whose plain average (3.0) differs from the weighted value the server computed (1.13)
  courses: [
    { id: 'c1', title: 'A', published: true, approvalStatus: 'APPROVED', enrolledCount: 200, rating: 5, totalReviews: 1, createdAt: '2026-01-01' },
    { id: 'c2', title: 'B', published: true, approvalStatus: 'APPROVED', enrolledCount: 50, rating: 1, totalReviews: 29, createdAt: '2026-01-01' },
  ],
  ...over,
});

describe('IMPLEMENT-02: Instructor Dashboard', () => {
  it('the service calls the existing dashboard route and returns its data as is', async () => {
    const calls: string[] = [];
    courseApi.defaults.adapter = (async (config: any) => {
      calls.push(config.url);
      return { data: { data: stats() }, status: 200, statusText: 'OK', headers: {}, config };
    }) as any;
    const result = await courseService.getInstructorDashboard();
    assert.deepEqual(calls, ['/api/courses/instructor/dashboard']);
    assert.equal(result.averageRating, 1.13);
    assert.equal(result.totalReviews, 30);
  });

  it('KPIs: the five server counts, the weighted rating and the review count - nothing re-averaged on the client', () => {
    const html = renderToStaticMarkup(<DashboardKpis stats={stats()} />);
    const t = text(html);
    assert.deepEqual([...html.matchAll(/data-kpi="([a-z]+)"/g)].map((m) => m[1]), ['total', 'published', 'pending', 'rejected', 'rating']);
    for (const [label, value] of [['Tổng số khóa học', '6'], ['Đã xuất bản', '3'], ['Chờ duyệt', '1'], ['Bị từ chối', '1']]) {
      assert.match(t, new RegExp(`${label} ${value}`), label);
    }
    assert.match(t, /Đánh giá trung bình 1\.1/, 'the server weighted average, not (5 + 1) / 2 = 3.0');
    assert.doesNotMatch(t, /3\.0/);
    assert.match(t, /Trên 30 lượt đánh giá/);
  });

  it('no listed-value / revenue / earnings / learner KPI and no fake "monthly enrollments"', () => {
    const t = text(renderToStaticMarkup(<DashboardKpis stats={stats()} />));
    assert.doesNotMatch(t, /niêm yết|doanh thu|thu nhập|thù lao|học viên|₫|VND|250/i);
    const labels = dashboardKpis(stats()).map((k) => k.label).join(' | ');
    assert.doesNotMatch(labels, /học viên|ghi danh|tháng|doanh thu/i);
    const page = readFileSync(PAGE, 'utf8');
    assert.doesNotMatch(page, /monthlyEnrollments|totalRevenue|niêm yết|price \* c\.enrolledCount|\.reduce\(/, 'the page computes no KPI from the course list');
    assert.match(page, /courseService\.getInstructorDashboard\(\)/);
  });

  it('no review yet: the rating shows "—", not 0.0', () => {
    const t = text(renderToStaticMarkup(<DashboardKpis stats={stats({ totalReviews: 0, averageRating: 0 })} />));
    assert.match(t, /Đánh giá trung bình —/);
    assert.match(t, /Chưa có lượt đánh giá nào/);
  });

  it('loading and error states (with retry) instead of zeros', () => {
    assert.match(renderToStaticMarkup(<DashboardKpis stats={null} loading />), /kpi-loading/);
    const err = renderToStaticMarkup(<DashboardKpis stats={null} error="Instructor access required" onRetry={() => {}} />);
    assert.match(err, /kpi-error/);
    assert.match(text(err), /Instructor access required Thử lại/);
    assert.doesNotMatch(text(err), /Tổng số khóa học 0/);
  });

  it('status of every course and the to-do notes: rejection reason, missing lessons', () => {
    assert.equal(courseStatus({ published: true, approvalStatus: 'APPROVED' }).label, 'Đã xuất bản');
    assert.equal(courseStatus({ published: false, approvalStatus: 'PENDING_REVIEW' }).label, 'Chờ duyệt');
    assert.equal(courseStatus({ published: false, approvalStatus: 'REJECTED' }).label, 'Bị từ chối');
    assert.equal(courseStatus({ published: false, approvalStatus: 'DRAFT' }).label, 'Bản nháp');
    assert.match(renderToStaticMarkup(<CourseStatusBadge course={{ published: false, approvalStatus: 'REJECTED' }} />), /bg-red-100/);

    const rejected = { published: false, approvalStatus: 'REJECTED' as const, rejectionReason: 'Video bài 2 bị lỗi âm thanh', _count: { lessons: 3, reviews: 0 } };
    assert.match(text(renderToStaticMarkup(<CourseTodoNotes course={rejected} />)), /Bị từ chối: Video bài 2 bị lỗi âm thanh/);
    assert.deepEqual(courseTodos({ ...rejected, rejectionReason: undefined }), ['Bị từ chối (không có lý do kèm theo)']);
    assert.deepEqual(courseTodos({ published: false, approvalStatus: 'DRAFT', _count: { lessons: 0, reviews: 0 } }), ['Chưa có bài học - cần ít nhất một bài học để gửi duyệt']);
    assert.deepEqual(courseTodos({ published: false, approvalStatus: 'DRAFT' }), [], 'no _count from the API: no guessed warning');
    assert.deepEqual(courseTodos({ published: true, approvalStatus: 'APPROVED', _count: { lessons: 5, reviews: 2 } }), []);
    assert.equal(renderToStaticMarkup(<CourseTodoNotes course={{ published: true, approvalStatus: 'APPROVED', _count: { lessons: 5, reviews: 2 } }} />), '');
  });

  it('the page handles each source on its own: list loading / error / empty, KPI error does not hide the list', () => {
    const page = readFileSync(PAGE, 'utf8');
    assert.match(page, /courses-loading/);
    assert.match(page, /courses-error/);
    assert.match(page, /Bạn chưa tạo khóa học nào/);
    assert.match(page, /loadStats\(\);\s*loadCourses\(\);/, 'both are loaded independently');
    assert.doesNotMatch(page, /if \(loading\) \{\s*return/, 'no whole-page spinner hiding everything');
    assert.match(page, /Lượt ghi danh/, 'the per-course figure is labelled as enrollments, not learners');
  });
});
