// Unit tests of the cross-service consistency check (synthetic part answers, no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtures, lessonRows, statusFields } from '../lib/fixtures.mjs';
import { checkConsistency } from '../lib/consistency.mjs';

const fx = loadFixtures();
const oid = (n) => n.toString(16).padStart(24, '0');

/** The answers the three parts would give for a database where DATA-01 was applied correctly. */
function perfect() {
  const idOf = Object.fromEntries(fx.accounts.map((a, i) => [a.key, oid(1000 + i)]));
  const adminId = idOf[fx.accounts.find((a) => a.role === 'ADMIN').key];
  const auth = { accounts: fx.accounts.map((a) => ({ key: a.key, id: idOf[a.key], action: 'reuse', diff: [], isActive: true })) };
  const user = { profiles: fx.accounts.map((a, i) => ({ key: a.key, userId: idOf[a.key], profileId: oid(5000 + i), role: a.role, isActive: true, action: 'reuse', diff: [] })) };
  const catId = Object.fromEntries(fx.categories.map((c, i) => [c.key, oid(9000 + i)]));
  const course = {
    categories: fx.categories.map((c) => ({ key: c.key, id: catId[c.key], action: 'reuse', diff: [] })),
    courses: fx.courses.map((c, i) => {
      const m = statusFields(c, adminId);
      return {
        key: c.key, id: oid(20000 + i), action: 'reuse', diff: [], lessons: { reuse: c.lessons.length, conflict: 0, extra: 0 },
        stored: {
          id: oid(20000 + i), instructorId: idOf[c.instructorKey], categoryId: catId[c.categoryKey], published: m.published, approvalStatus: m.approvalStatus,
          approvedBy: m.approvedBy, approvedAt: m.approvedAt, rejectionReason: m.rejectionReason, price: c.price, rating: 0, totalReviews: 0, enrolledCount: 0,
          lessons: lessonRows(c).map(({ order, title, duration, isPreview, videoUrl }) => ({ order, title, duration, isPreview, videoUrl })),
        },
      };
    }),
    orphanLessons: 0,
  };
  return { auth, user, course, idOf };
}
const run = (s, o) => checkConsistency(fx, s.auth, s.user, s.course, o);
const has = (r, re) => r.errors.some((e) => re.test(e));

test('a correct database is consistent and complete', () => {
  const r = run(perfect(), { expectComplete: true });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.missing, []);
  assert.equal(r.counts.lessons, fx.courses.reduce((n, c) => n + c.lessons.length, 0));
});

test('an empty database: everything missing, no error unless --complete', () => {
  const empty = {
    auth: { accounts: fx.accounts.map((a) => ({ key: a.key, id: null, action: 'create' })) },
    user: { profiles: fx.accounts.map((a) => ({ key: a.key, userId: null, action: 'create-pending-account' })) },
    course: { categories: fx.categories.map((c) => ({ key: c.key, action: 'create' })), courses: fx.courses.map((c) => ({ key: c.key, action: 'create-pending', stored: null })), orphanLessons: 0 },
  };
  const r = run(empty);
  assert.deepEqual(r.errors, []);
  assert.ok(r.missing.length >= fx.accounts.length + fx.categories.length + fx.courses.length);
  assert.ok(run(empty, { expectComplete: true }).errors.length > 0);
});

test('profile linked to another userId, or with a different role, is an error', () => {
  let s = perfect();
  s.user.profiles[3].userId = oid(1);
  assert.ok(has(run(s), /is not the auth id/));
  s = perfect();
  s.user.profiles.find((p) => p.key === 'INS_02').role = 'STUDENT';
  const r = run(s);
  assert.ok(has(r, /role STUDENT, expected INSTRUCTOR/));
  assert.ok(has(r, /instructor INS_02 has no verified INSTRUCTOR profile/));
});

test('course owned by the wrong account, approved by a non-admin, or a broken status combination is an error', () => {
  let s = perfect();
  s.course.courses[0].stored.instructorId = s.idOf.INS_03;
  assert.ok(has(run(s), /instructorId is not the account of INS_01/));
  s = perfect();
  const approved = s.course.courses.find((c) => c.stored.approvalStatus === 'APPROVED');
  approved.stored.approvedBy = s.idOf.STU_05;
  assert.ok(has(run(s), /approvedBy is not the verified ADMIN/));
  s = perfect();
  s.course.courses.find((c) => c.stored.approvalStatus === 'APPROVED').stored.published = false;
  assert.ok(has(run(s), /APPROVED but not published/));
  s = perfect();
  s.course.courses.find((c) => c.stored.approvalStatus === 'DRAFT').stored.published = true;
  assert.ok(has(run(s), /DRAFT but published/));
  s = perfect();
  s.course.courses.find((c) => c.stored.approvalStatus === 'REJECTED').stored.rejectionReason = null;
  assert.ok(has(run(s), /REJECTED without a reason/));
});

test('invented aggregates, lesson gaps, bad durations, fake video URLs and orphans are errors', () => {
  let s = perfect();
  s.course.courses[4].stored.enrolledCount = 57;
  assert.ok(has(run(s), /must come from real data/));
  s = perfect();
  s.course.courses[6].stored.lessons[2].order = 40;
  assert.ok(has(run(s), /lesson orders are not 0\.\./));
  s = perfect();
  s.course.courses[6].stored.lessons[1].duration = 0;
  assert.ok(has(run(s), /duration must be positive/));
  s = perfect();
  s.course.courses[6].stored.lessons[1].videoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
  assert.ok(has(run(s), /videoUrl is not a served file/));
  s = perfect();
  s.course.courses[6].stored.lessons[1].videoUrl = 'd:/HK/HK8/video.mp4';
  assert.ok(has(run(s), /videoUrl is not a served file/));
  s = perfect();
  s.course.orphanLessons = 3;
  assert.ok(has(run(s), /belong to a course that does not exist/));
  s = perfect();
  s.course.courses[2].lessons.extra = 1;
  assert.ok(has(run(s), /not in the fixture/));
});

test('a served course file URL is accepted as a lesson video', () => {
  const s = perfect();
  s.course.courses[6].stored.lessons[1].videoUrl = '/api/courses/files/download?bucket=courses&key=1730000000000-abc.mp4';
  assert.deepEqual(run(s).errors, []);
});
