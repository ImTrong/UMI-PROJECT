// Unit tests of the DATA-01 fixtures and their validation (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtures, validateFixtures, buildPartInputs, statusFields, lessonRows, EXPECTED } from '../lib/fixtures.mjs';

const fx = loadFixtures();
const clone = () => structuredClone(fx);
const has = (errors, re) => errors.some((e) => re.test(e));

test('the shipped fixtures are valid', () => {
  assert.deepEqual(validateFixtures(fx), []);
});

test('sizes: 1 admin, 5 instructors, 40 students, 6 categories, 30 courses, 8-14 lessons each', () => {
  const byRole = (r) => fx.accounts.filter((a) => a.role === r).length;
  assert.equal(byRole('ADMIN'), 1);
  assert.equal(byRole('INSTRUCTOR'), 5);
  assert.equal(byRole('STUDENT'), 40);
  assert.equal(fx.categories.length, 6);
  assert.equal(fx.courses.length, 30);
  for (const c of fx.courses) assert.ok(c.lessons.length >= 8 && c.lessons.length <= 14, c.key);
});

test('status distribution 20 / 4 / 3 / 3 and 6 courses per instructor', () => {
  const by = (s) => fx.courses.filter((c) => c.status === s).length;
  assert.deepEqual({ APPROVED: by('APPROVED'), PENDING_REVIEW: by('PENDING_REVIEW'), DRAFT: by('DRAFT'), REJECTED: by('REJECTED') }, EXPECTED.statuses);
  for (const ins of fx.accounts.filter((a) => a.role === 'INSTRUCTOR')) assert.equal(fx.courses.filter((c) => c.instructorKey === ins.key).length, 6, ins.key);
});

test('every e-mail is a development address and no fixture holds a password', () => {
  for (const a of fx.accounts) assert.match(a.email, /^[a-z0-9.]+@umi-demo\.local$/);
  assert.doesNotMatch(JSON.stringify(fx), /"password/i);
});

test('every course belongs to an INSTRUCTOR account and a known category; every lesson has a positive duration', () => {
  const ins = new Set(fx.accounts.filter((a) => a.role === 'INSTRUCTOR').map((a) => a.key));
  const cats = new Set(fx.categories.map((c) => c.key));
  for (const c of fx.courses) {
    assert.ok(ins.has(c.instructorKey), c.key);
    assert.ok(cats.has(c.categoryKey), c.key);
    for (const l of lessonRows(c)) assert.ok(l.duration > 0);
  }
});

test('duplicate email / slug / key are detected', () => {
  let f = clone();
  f.accounts[7].email = f.accounts[8].email;
  assert.ok(has(validateFixtures(f), /duplicate account email/));
  f = clone();
  f.courses[3].slug = f.courses[4].slug;
  assert.ok(has(validateFixtures(f), /duplicate course slug/));
  f = clone();
  f.categories[1].slug = f.categories[2].slug;
  assert.ok(has(validateFixtures(f), /duplicate category slug/));
  f = clone();
  f.accounts[10].key = f.accounts[11].key;
  assert.ok(has(validateFixtures(f), /duplicate account key/));
});

test('role, owner and status problems are detected', () => {
  let f = clone();
  f.accounts.find((a) => a.key === 'STU_01').role = 'TEACHER';
  assert.ok(has(validateFixtures(f), /unknown role/));
  f = clone();
  f.courses[0].instructorKey = 'STU_01';
  assert.ok(has(validateFixtures(f), /is not an INSTRUCTOR account/));
  f = clone();
  f.courses.find((c) => c.status === 'DRAFT').status = 'PUBLISHED';
  assert.ok(has(validateFixtures(f), /invalid status/));
  f = clone();
  delete f.courses.find((c) => c.status === 'REJECTED').rejectionReason;
  assert.ok(has(validateFixtures(f), /rejectionReason is required/));
  f = clone();
  f.courses.find((c) => c.status === 'PENDING_REVIEW').approvedAt = '2026-05-01T00:00:00Z';
  assert.ok(has(validateFixtures(f), /only APPROVED courses have approvedAt/));
});

test('generic titles, empty descriptions, filler, preset aggregates and non-dev emails are detected', () => {
  let f = clone();
  f.courses[2].lessons[4].title = 'Bài học 5';
  assert.ok(has(validateFixtures(f), /title must be specific/));
  f = clone();
  f.courses[2].lessons[4].description = '';
  assert.ok(has(validateFixtures(f), /description is required/));
  f = clone();
  f.courses[5].description = 'Lorem ipsum dolor sit amet, consectetur.';
  assert.ok(has(validateFixtures(f), /filler text/));
  f = clone();
  f.courses[5].enrolledCount = 120;
  assert.ok(has(validateFixtures(f), /enrolledCount must not be set/));
  f = clone();
  f.accounts[3].email = 'someone@gmail.com';
  assert.ok(has(validateFixtures(f), /email must be lower case in @umi-demo.local/));
  f = clone();
  f.accounts[3].password = 'Secret123456';
  assert.ok(has(validateFixtures(f), /must not contain a password/));
  f = clone();
  f.courses[1].price = 399999.5;
  assert.ok(has(validateFixtures(f), /price must be a whole number/));
});

test('unbalanced instructors and wrong totals are detected', () => {
  const f = clone();
  f.courses[0].instructorKey = 'INS_02';
  f.courses[1].instructorKey = 'INS_02';
  assert.ok(has(validateFixtures(f), /not balanced/));
  const g = clone();
  g.courses.pop();
  assert.ok(has(validateFixtures(g), /expected 30 courses/));
});

test('statusFields gives only the combinations the course-service produces', () => {
  const byStatus = Object.fromEntries(fx.courses.map((c) => [c.status, c]));
  assert.deepEqual(statusFields(byStatus.APPROVED, 'a'.repeat(24)), { published: true, approvalStatus: 'APPROVED', approvedAt: new Date(byStatus.APPROVED.approvedAt).toISOString(), approvedBy: 'a'.repeat(24), rejectionReason: null });
  assert.equal(statusFields(byStatus.PENDING_REVIEW).published, false);
  assert.equal(statusFields(byStatus.DRAFT).approvalStatus, 'DRAFT');
  const r = statusFields(byStatus.REJECTED);
  assert.equal(r.published, false);
  assert.equal(r.rejectionReason, byStatus.REJECTED.rejectionReason);
  assert.equal(r.approvedBy, null);
});

test('lesson rows: order 0..n-1, seconds, first lesson preview, no video URL invented', () => {
  for (const c of fx.courses) {
    const rows = lessonRows(c);
    assert.deepEqual(rows.map((r) => r.order), rows.map((_, i) => i));
    assert.equal(rows[0].isPreview, true);
    for (const [i, r] of rows.entries()) {
      assert.equal(r.duration, c.lessons[i].minutes * 60);
      assert.equal(r.videoUrl, '');
    }
  }
  const inputs = buildPartInputs(fx);
  assert.equal(inputs.courses.reduce((n, c) => n + c.lessons.length, 0), fx.courses.reduce((n, c) => n + c.lessons.length, 0));
  assert.ok(inputs.courses.every((c) => c.categorySlug));
});
