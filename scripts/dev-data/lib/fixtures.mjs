// Fixture loading, validation and conversion for DATA-01 (accounts, profiles, categories, courses, lessons).
// Pure functions only: nothing here touches a database, the network or the file system except loadFixtures().
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATASET = 'DATA-01';
export const DEV_EMAIL_DOMAIN = '@umi-demo.local';
export const ROLES = ['ADMIN', 'INSTRUCTOR', 'STUDENT'];
export const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
// The schema's ApprovalStatus values (services/course-service/prisma/schema.prisma)
export const STATUSES = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'];
export const EXPECTED = {
  roles: { ADMIN: 1, INSTRUCTOR: 5, STUDENT: 40 },
  categories: 6,
  courses: 30,
  statuses: { APPROVED: 20, PENDING_REVIEW: 4, DRAFT: 3, REJECTED: 3 },
  lessonsPerCourse: { min: 8, max: 14 },
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(HERE, '..', 'data');

export function loadFixtures(dir = DATA_DIR) {
  const read = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  return { accounts: read('accounts.json').accounts, categories: read('catalog.json').categories, courses: read('courses.json').courses };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const GENERIC_TITLE = /^(bài|bai|bài học|lesson|khóa học|khoa hoc|course|chương|chapter)\s*\d+\s*$/i;
const FILLER = /lorem|ipsum|dolor sit|placeholder|todo|tbd/i;
const isNonEmpty = (s, min = 1) => typeof s === 'string' && s.trim().length >= min;
const isStringList = (v) => Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every((x) => isNonEmpty(x) && x.length <= 500);
const validDate = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

/** All problems of the fixtures, as readable strings. An empty list means the fixtures are usable. */
export function validateFixtures({ accounts, categories, courses }, { now = new Date() } = {}) {
  const errors = [];
  const err = (m) => errors.push(m);
  const dup = (list, pick, label) => {
    const seen = new Set();
    for (const x of list) {
      const v = pick(x);
      if (seen.has(v)) err(`duplicate ${label}: ${v}`);
      seen.add(v);
    }
  };

  // ---- accounts ----
  dup(accounts, (a) => a.key, 'account key');
  dup(accounts, (a) => String(a.email).toLowerCase(), 'account email');
  const roleCount = Object.fromEntries(ROLES.map((r) => [r, 0]));
  for (const a of accounts) {
    const where = `account ${a.key}`;
    if (!ROLES.includes(a.role)) err(`${where}: unknown role ${a.role}`);
    else roleCount[a.role]++;
    if (typeof a.email !== 'string' || a.email !== a.email.toLowerCase() || !a.email.endsWith(DEV_EMAIL_DOMAIN) || !/^[a-z0-9.]+@/.test(a.email)) {
      err(`${where}: email must be lower case in ${DEV_EMAIL_DOMAIN}`);
    }
    if (!isNonEmpty(a.fullName, 3)) err(`${where}: fullName is required`);
    if (!isNonEmpty(a.bio, 20)) err(`${where}: bio is required`);
    if ('password' in a || 'passwordHash' in a) err(`${where}: fixtures must not contain a password`);
    if (a.dateOfBirth !== undefined && (!DATE_ONLY.test(a.dateOfBirth) || !validDate(a.dateOfBirth))) err(`${where}: invalid dateOfBirth`);
    if (a.role === 'INSTRUCTOR') {
      if (!Array.isArray(a.education) || a.education.length === 0) err(`${where}: an instructor needs an education entry`);
      if (!Array.isArray(a.work) || a.work.length === 0) err(`${where}: an instructor needs a work entry`);
    }
    for (const e of a.education || []) {
      if (!isNonEmpty(e.institution) || !isNonEmpty(e.degree) || !isNonEmpty(e.fieldOfStudy) || !validDate(e.startDate)) err(`${where}: incomplete education entry`);
      if (e.endDate !== undefined && (!validDate(e.endDate) || Date.parse(e.endDate) < Date.parse(e.startDate))) err(`${where}: education endDate before startDate`);
    }
    for (const w of a.work || []) {
      if (!isNonEmpty(w.company) || !isNonEmpty(w.position) || !validDate(w.startDate) || typeof w.current !== 'boolean') err(`${where}: incomplete work entry`);
      if (w.current && w.endDate !== undefined) err(`${where}: a current job has no endDate`);
      if (!w.current && !validDate(w.endDate)) err(`${where}: a past job needs an endDate`);
    }
    if ([a.fullName, a.bio].some((s) => FILLER.test(String(s)))) err(`${where}: filler text`);
  }
  for (const r of ROLES) if (roleCount[r] !== EXPECTED.roles[r]) err(`expected ${EXPECTED.roles[r]} ${r} accounts, found ${roleCount[r]}`);

  // ---- categories ----
  if (categories.length !== EXPECTED.categories) err(`expected ${EXPECTED.categories} categories, found ${categories.length}`);
  dup(categories, (c) => c.key, 'category key');
  dup(categories, (c) => c.slug, 'category slug');
  dup(categories, (c) => c.name, 'category name');
  for (const c of categories) {
    if (!SLUG.test(c.slug)) err(`category ${c.key}: invalid slug`);
    if (!isNonEmpty(c.name, 3) || !isNonEmpty(c.description, 20)) err(`category ${c.key}: name and description are required`);
  }

  // ---- courses ----
  if (courses.length !== EXPECTED.courses) err(`expected ${EXPECTED.courses} courses, found ${courses.length}`);
  dup(courses, (c) => c.key, 'course key');
  dup(courses, (c) => c.slug, 'course slug');
  dup(courses, (c) => c.title.toLowerCase(), 'course title');
  const accountByKey = new Map(accounts.map((a) => [a.key, a]));
  const categoryKeys = new Set(categories.map((c) => c.key));
  const statusCount = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const perInstructor = {};
  for (const c of courses) {
    const where = `course ${c.key}`;
    if (!SLUG.test(c.slug)) err(`${where}: invalid slug`);
    if (!isNonEmpty(c.title, 3) || c.title.length > 200) err(`${where}: title must be 3-200 characters`);
    if (!isNonEmpty(c.description, 10) || c.description.length > 5000) err(`${where}: description must be 10-5000 characters`);
    if (!isNonEmpty(c.whatYouWillLearn, 20) || c.whatYouWillLearn.length > 5000) err(`${where}: whatYouWillLearn is required`);
    if (!isStringList(c.requirements)) err(`${where}: requirements must be a non-empty list`);
    if (!isStringList(c.targetAudience)) err(`${where}: targetAudience must be a non-empty list`);
    if (!categoryKeys.has(c.categoryKey)) err(`${where}: unknown category ${c.categoryKey}`);
    const ins = accountByKey.get(c.instructorKey);
    if (!ins || ins.role !== 'INSTRUCTOR') err(`${where}: instructor ${c.instructorKey} is not an INSTRUCTOR account`);
    perInstructor[c.instructorKey] = (perInstructor[c.instructorKey] || 0) + 1;
    if (!LEVELS.includes(c.level)) err(`${where}: invalid level`);
    if (!isNonEmpty(c.language) || c.language.length > 50) err(`${where}: invalid language`);
    // price is a Float of VND in the schema; whole thousands only, 0 = free (the app treats only price === 0 as free)
    if (!Number.isInteger(c.price) || c.price < 0 || c.price % 1000 !== 0) err(`${where}: price must be a whole number of VND in thousands`);
    if (!STATUSES.includes(c.status)) err(`${where}: invalid status ${c.status}`);
    else statusCount[c.status]++;
    if ((c.status === 'REJECTED') !== isNonEmpty(c.rejectionReason, 20)) err(`${where}: rejectionReason is required for REJECTED courses only`);
    if (!validDate(c.createdAt) || Date.parse(c.createdAt) > now.getTime()) err(`${where}: createdAt must be a past date`);
    if (c.status === 'APPROVED') {
      if (!validDate(c.approvedAt) || Date.parse(c.approvedAt) < Date.parse(c.createdAt) || Date.parse(c.approvedAt) > now.getTime()) err(`${where}: approvedAt must be between createdAt and now`);
    } else if (c.approvedAt !== undefined) err(`${where}: only APPROVED courses have approvedAt`);
    for (const k of ['rating', 'totalReviews', 'enrolledCount', 'thumbnail', 'videoUrl']) if (k in c) err(`${where}: ${k} must not be set by the fixture`);
    if ([c.title, c.description, c.whatYouWillLearn].some((s) => FILLER.test(String(s)))) err(`${where}: filler text`);

    const lessons = Array.isArray(c.lessons) ? c.lessons : [];
    if (lessons.length < EXPECTED.lessonsPerCourse.min || lessons.length > EXPECTED.lessonsPerCourse.max) err(`${where}: ${lessons.length} lessons (expected ${EXPECTED.lessonsPerCourse.min}-${EXPECTED.lessonsPerCourse.max})`);
    dup(lessons.map((l) => ({ ...l, t: `${c.key}/${String(l.title).toLowerCase()}` })), (l) => l.t, 'lesson title');
    const previews = lessons.filter((l) => l.preview === true).length;
    if (previews < 1 || previews > 3) err(`${where}: needs 1-3 preview lessons, has ${previews}`);
    if (lessons.length > 0 && lessons[0].preview !== true) err(`${where}: the first lesson should be a preview`);
    lessons.forEach((l, i) => {
      const lw = `${where} lesson ${i}`;
      if (!isNonEmpty(l.title, 3) || l.title.length > 200 || GENERIC_TITLE.test(l.title.trim())) err(`${lw}: title must be specific (3-200 characters)`);
      if (!isNonEmpty(l.description, 15) || l.description.length > 5000) err(`${lw}: description is required`);
      if (!Number.isInteger(l.minutes) || l.minutes < 1 || l.minutes > 240) err(`${lw}: minutes must be 1-240`);
      if (l.preview !== undefined && typeof l.preview !== 'boolean') err(`${lw}: preview must be a boolean`);
      if ('videoUrl' in l || 'order' in l) err(`${lw}: videoUrl/order are derived, not fixture fields`);
      if (FILLER.test(`${l.title} ${l.description}`)) err(`${lw}: filler text`);
    });
  }
  for (const s of STATUSES) if (statusCount[s] !== EXPECTED.statuses[s]) err(`expected ${EXPECTED.statuses[s]} ${s} courses, found ${statusCount[s]}`);
  const insKeys = accounts.filter((a) => a.role === 'INSTRUCTOR').map((a) => a.key);
  const counts = insKeys.map((k) => perInstructor[k] || 0);
  if (insKeys.length > 0 && Math.max(...counts) - Math.min(...counts) > 1) err(`courses are not balanced between instructors: ${JSON.stringify(perInstructor)}`);
  for (const k of insKeys) if (!courses.some((c) => c.instructorKey === k && c.status === 'APPROVED')) err(`instructor ${k} has no APPROVED course`);
  return errors;
}

/** The moderation fields of a course in a given status, exactly as CourseService.approveCourse / rejectCourse / publishCourse leave them. */
export function statusFields(course, adminId) {
  switch (course.status) {
    case 'APPROVED':
      return { published: true, approvalStatus: 'APPROVED', approvedAt: new Date(course.approvedAt).toISOString(), approvedBy: adminId ?? null, rejectionReason: null };
    case 'REJECTED':
      return { published: false, approvalStatus: 'REJECTED', approvedAt: null, approvedBy: null, rejectionReason: course.rejectionReason };
    case 'PENDING_REVIEW':
      return { published: false, approvalStatus: 'PENDING_REVIEW', approvedAt: null, approvedBy: null, rejectionReason: null };
    case 'DRAFT':
      return { published: false, approvalStatus: 'DRAFT', approvedAt: null, approvedBy: null, rejectionReason: null };
    default:
      throw new Error(`unknown status ${course.status}`);
  }
}

/** Lesson rows of a course: order 0..n-1 (as LessonService.createLesson appends), duration in seconds, no video yet. */
export function lessonRows(course) {
  return course.lessons.map((l, i) => ({
    order: i,
    title: l.title,
    description: l.description,
    duration: l.minutes * 60,
    isPreview: l.preview === true,
    // No dev media is served yet: an empty videoUrl makes the learner page show the lesson as text (Learning.tsx), and no
    // path that does not exist is stored. A later phase sets a served MinIO URL here.
    videoUrl: '',
    resources: [],
  }));
}

/** Inputs of the service parts, built from the fixtures (ids are filled in by the orchestrator once known). */
export function buildPartInputs(fx) {
  const accounts = fx.accounts.map((a) => ({
    key: a.key,
    role: a.role,
    email: a.email,
    fullName: a.fullName,
    bio: a.bio,
    address: a.address ?? null,
    dateOfBirth: a.dateOfBirth ?? null,
    education: (a.education || []).map((e) => ({ institution: e.institution, degree: e.degree, fieldOfStudy: e.fieldOfStudy, startDate: e.startDate, endDate: e.endDate ?? null, grade: e.grade ?? null, description: e.description ?? null })),
    work: (a.work || []).map((w) => ({ company: w.company, position: w.position, location: w.location ?? null, startDate: w.startDate, endDate: w.endDate ?? null, current: w.current === true, description: w.description ?? null })),
  }));
  const categorySlug = new Map(fx.categories.map((c) => [c.key, c.slug]));
  const categories = fx.categories.map((c) => ({ key: c.key, name: c.name, slug: c.slug, icon: c.icon ?? null, description: c.description }));
  const courses = fx.courses.map((c) => ({
    key: c.key,
    slug: c.slug,
    title: c.title,
    description: c.description,
    categorySlug: categorySlug.get(c.categoryKey),
    instructorKey: c.instructorKey,
    price: c.price,
    level: c.level,
    language: c.language,
    whatYouWillLearn: c.whatYouWillLearn,
    requirements: c.requirements,
    targetAudience: c.targetAudience,
    status: c.status,
    rejectionReason: c.rejectionReason ?? null,
    approvedAt: c.approvedAt ?? null,
    createdAt: new Date(c.createdAt).toISOString(),
    lessons: lessonRows(c),
  }));
  return { accounts, categories, courses };
}
