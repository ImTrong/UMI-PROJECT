// Cross-service consistency of the DATA-01 records, computed from the read-only 'plan' answers of the three parts.
// Pure: (fixtures, auth plan, user plan, course plan) -> { errors, missing, counts }.
//   errors  = something stored is wrong (wrong userId link, role, owner, status combination, lesson order, orphan, duplicate...)
//   missing = fixture records not created yet (normal before --apply; an error only with { expectComplete: true })
import { statusFields, lessonRows } from './fixtures.mjs';

const SERVED_VIDEO = [/^$/, /^\/api\/courses\/files\/download\?bucket=courses&key=[\w.-]+$/];

export function checkConsistency(fx, auth, user, course, { expectComplete = false } = {}) {
  const errors = [];
  const missing = [];
  const authByKey = new Map(auth.accounts.map((a) => [a.key, a]));
  const profByKey = new Map(user.profiles.map((p) => [p.key, p]));

  // ---- accounts <-> profiles ----
  const userIdOf = {};
  for (const a of fx.accounts) {
    const au = authByKey.get(a.key);
    const pr = profByKey.get(a.key);
    if (!au || au.action === 'create') { missing.push(`account ${a.key}`); continue; }
    if (au.action === 'conflict') { errors.push(`account ${a.key}: stored account differs (${au.diff.join(', ')})`); continue; }
    if (au.isActive !== true) errors.push(`account ${a.key}: not active`);
    userIdOf[a.key] = au.id;
    if (!pr || pr.action === 'create' || pr.action === 'create-pending-account') { missing.push(`profile ${a.key}`); continue; }
    if (pr.action === 'conflict') { errors.push(`profile ${a.key}: stored profile differs (${pr.diff.join(', ')})`); continue; }
    if (pr.userId !== au.id) errors.push(`profile ${a.key}: userId ${pr.userId} is not the auth id ${au.id}`);
    if (pr.role !== a.role) errors.push(`profile ${a.key}: role ${pr.role}, expected ${a.role}`);
    if (pr.isActive !== true) errors.push(`profile ${a.key}: not active`);
    if (pr.diff && pr.diff.length) errors.push(`profile ${a.key}: ${pr.diff.join(', ')} differ`);
  }
  const roleOk = (key, role) => {
    const pr = profByKey.get(key);
    return !!pr && pr.action !== 'conflict' && pr.role === role && pr.userId === userIdOf[key];
  };
  const adminKey = fx.accounts.find((a) => a.role === 'ADMIN')?.key;
  const adminId = adminKey && roleOk(adminKey, 'ADMIN') ? userIdOf[adminKey] : null;

  // ---- categories ----
  const catIdBySlug = {};
  for (const c of fx.categories) {
    const r = course.categories.find((x) => x.key === c.key);
    if (!r || r.action === 'create') { missing.push(`category ${c.key}`); continue; }
    if (r.action === 'conflict') { errors.push(`category ${c.key}: stored category differs (${r.diff.join(', ')})`); continue; }
    catIdBySlug[c.slug] = r.id;
  }

  // ---- courses + lessons ----
  const catSlugByKey = new Map(fx.categories.map((c) => [c.key, c.slug]));
  for (const c of fx.courses) {
    const r = course.courses.find((x) => x.key === c.key);
    if (!r || !r.stored) {
      if (r && r.action === 'conflict') errors.push(`course ${c.key}: ${r.diff.join(', ')}`);
      else missing.push(`course ${c.key}`);
      continue;
    }
    const s = r.stored;
    if (r.action === 'conflict') errors.push(`course ${c.key}: stored course differs (${r.diff.join(', ')})`);
    if (!roleOk(c.instructorKey, 'INSTRUCTOR')) errors.push(`course ${c.key}: instructor ${c.instructorKey} has no verified INSTRUCTOR profile`);
    else if (s.instructorId !== userIdOf[c.instructorKey]) errors.push(`course ${c.key}: instructorId is not the account of ${c.instructorKey}`);
    const catId = catIdBySlug[catSlugByKey.get(c.categoryKey)];
    if (catId && s.categoryId !== catId) errors.push(`course ${c.key}: wrong category`);
    const m = statusFields(c, adminId);
    if (s.approvalStatus !== m.approvalStatus) errors.push(`course ${c.key}: status ${s.approvalStatus}, expected ${m.approvalStatus}`);
    // the combinations the app can produce (CourseService.publishCourse / approveCourse / rejectCourse)
    if (s.approvalStatus === 'APPROVED') {
      if (s.published !== true) errors.push(`course ${c.key}: APPROVED but not published`);
      if (!s.approvedAt) errors.push(`course ${c.key}: APPROVED without approvedAt`);
      if (!adminId || s.approvedBy !== adminId) errors.push(`course ${c.key}: approvedBy is not the verified ADMIN account`);
    } else if (s.published !== false) errors.push(`course ${c.key}: ${s.approvalStatus} but published`);
    if (s.approvalStatus === 'REJECTED' && !s.rejectionReason) errors.push(`course ${c.key}: REJECTED without a reason`);
    if (s.approvalStatus !== 'REJECTED' && s.rejectionReason) errors.push(`course ${c.key}: rejectionReason on a ${s.approvalStatus} course`);
    // phase 1 creates no review or enrollment, so the aggregates must still be the schema default
    if (s.rating !== 0 || s.totalReviews !== 0 || s.enrolledCount !== 0) errors.push(`course ${c.key}: rating/totalReviews/enrolledCount must come from real data (found ${s.rating}/${s.totalReviews}/${s.enrolledCount})`);

    const expected = lessonRows(c);
    if (r.lessons && r.lessons.conflict) errors.push(`course ${c.key}: ${r.lessons.conflict} lesson(s) differ from the fixture`);
    if (r.lessons && r.lessons.extra) errors.push(`course ${c.key}: ${r.lessons.extra} lesson(s) not in the fixture`);
    const orders = s.lessons.map((l) => l.order);
    if (new Set(orders).size !== orders.length) errors.push(`course ${c.key}: duplicate lesson order`);
    if (s.lessons.length < expected.length) missing.push(`${expected.length - s.lessons.length} lesson(s) of ${c.key}`);
    for (const l of s.lessons) {
      const e = expected.find((x) => x.order === l.order);
      if (!e) continue;
      if (l.title !== e.title) errors.push(`course ${c.key} lesson ${l.order}: title differs`);
      if (!(l.duration > 0)) errors.push(`course ${c.key} lesson ${l.order}: duration must be positive`);
      if (!SERVED_VIDEO.some((re) => re.test(l.videoUrl ?? ''))) errors.push(`course ${c.key} lesson ${l.order}: videoUrl is not a served file`);
    }
    if (s.lessons.length === expected.length && orders.some((o, i) => o !== i)) errors.push(`course ${c.key}: lesson orders are not 0..${expected.length - 1}`);
  }
  if (course.orphanLessons > 0) errors.push(`${course.orphanLessons} lesson(s) belong to a course that does not exist`);

  if (expectComplete) for (const m of missing) errors.push(`missing: ${m}`);
  return {
    errors,
    missing,
    counts: {
      accounts: fx.accounts.length - missing.filter((m) => m.startsWith('account ')).length,
      profiles: fx.accounts.length - missing.filter((m) => m.startsWith('account ') || m.startsWith('profile ')).length,
      categories: fx.categories.length - missing.filter((m) => m.startsWith('category ')).length,
      courses: course.courses.filter((x) => x.stored).length,
      lessons: course.courses.reduce((n, x) => n + (x.stored ? x.stored.lessons.length : 0), 0),
    },
  };
}
