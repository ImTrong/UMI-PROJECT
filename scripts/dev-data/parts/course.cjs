/* eslint-disable */
// DATA-01 part for course_db (categories, courses, lessons). Runs with the course-service's own Prisma client, INPUT prepended.
//   mode 'plan'  : read-only. Per category / course / lesson: create | reuse | conflict | blocked, plus a snapshot of what is
//                  stored (for verify-consistency) and the number of lessons whose course does not exist.
//   mode 'apply' : creates what is missing. A course is created only when its instructor id was verified by the caller
//                  (account + INSTRUCTOR profile) and, when APPROVED, the approving ADMIN id is known. Refused without the
//                  unique indexes (categories.slug/name, courses.slug, lessons courseId+order).
// Natural keys: category slug, course slug, lesson (courseId, order). Nothing existing is ever updated or deleted.
// rating / totalReviews / enrolledCount are left at the schema default 0 - they come from real reviews / enrollments later.
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();
const out = (o) => console.log('RESULT:' + JSON.stringify(o));

async function uniqueIndexState(collection, wanted) {
  let indexes = [];
  let exists = true;
  try {
    const r = await prisma.$runCommandRaw({ listIndexes: collection });
    indexes = (r.cursor && r.cursor.firstBatch) || [];
  } catch (e) {
    if (/NamespaceNotFound|ns does not exist|\(26\)/i.test(String(e.message))) exists = false;
    else throw e;
  }
  const missing = wanted.filter((keys) => !indexes.some((i) => i.unique === true && JSON.stringify(Object.keys(i.key || {})) === JSON.stringify(keys)));
  return { collection, exists, missing: missing.map((k) => k.join('+')) };
}

const same = (a, b) => (a ?? null) === (b ?? null);
const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const iso = (d) => (d ? new Date(d).toISOString() : null);

async function othersDigest(slugs, catSlugs) {
  const courses = await prisma.course.findMany({
    where: { slug: { notIn: slugs } },
    orderBy: { id: 'asc' },
    select: { id: true, slug: true, title: true, instructorId: true, price: true, published: true, approvalStatus: true, rating: true, totalReviews: true, enrolledCount: true },
  });
  const categories = await prisma.category.findMany({ where: { slug: { notIn: catSlugs } }, orderBy: { id: 'asc' }, select: { id: true, slug: true, name: true } });
  const ids = courses.map((c) => c.id);
  const lessons = ids.length ? await prisma.lesson.findMany({ where: { courseId: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, courseId: true, order: true, title: true, videoUrl: true, duration: true } }) : [];
  const body = JSON.stringify({ courses, categories, lessons });
  return { courses: courses.length, categories: categories.length, lessons: lessons.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
}

function courseDiff(row, c, categoryId, instructorId, adminId) {
  const m = c.moderation;
  const diff = [];
  const check = (field, ok) => { if (!ok) diff.push(field); };
  check('title', row.title === c.title);
  check('description', row.description === c.description);
  check('instructorId', instructorId !== null && row.instructorId === instructorId);
  check('categoryId', categoryId !== null && same(row.categoryId, categoryId));
  check('price', row.price === c.price);
  check('level', row.level === c.level);
  check('language', row.language === c.language);
  check('whatYouWillLearn', same(row.whatYouWillLearn, c.whatYouWillLearn));
  check('requirements', sameList(row.requirements, c.requirements));
  check('targetAudience', sameList(row.targetAudience, c.targetAudience));
  check('published', row.published === m.published);
  check('approvalStatus', row.approvalStatus === m.approvalStatus);
  check('rejectionReason', same(row.rejectionReason, m.rejectionReason));
  if (m.approvalStatus === 'APPROVED') check('approvedBy', adminId !== null && row.approvedBy === adminId);
  return diff;
}

function lessonDiff(row, l) {
  const diff = [];
  if (row.title !== l.title) diff.push('title');
  if (!same(row.description, l.description)) diff.push('description');
  if (row.duration !== l.duration) diff.push('duration');
  if (row.isPreview !== l.isPreview) diff.push('isPreview');
  // videoUrl / resources are not compared: a later media phase may attach served files to these lessons
  return diff;
}

(async () => {
  const { mode, adminId = null, instructors = {}, categories, courses } = INPUT;
  if (mode !== 'plan' && mode !== 'apply') throw new Error(`unknown mode ${mode}`);
  const apply = mode === 'apply';
  const indexes = [
    await uniqueIndexState('categories', [['name'], ['slug']]),
    await uniqueIndexState('courses', [['slug']]),
    await uniqueIndexState('lessons', [['courseId', 'order']]),
  ];
  if (apply && indexes.some((i) => i.missing.length > 0)) {
    throw new Error('course_db is missing unique indexes (categories name/slug, courses slug, lessons courseId+order) - run the schema sync (prisma db push) first; nothing was written');
  }
  const slugs = courses.map((c) => c.slug);
  const catSlugs = categories.map((c) => c.slug);
  const before = await othersDigest(slugs, catSlugs);

  // ---- categories ----
  const categoryResult = [];
  const categoryId = {};
  for (const c of categories) {
    const bySlug = await prisma.category.findMany({ where: { slug: c.slug } });
    const byName = await prisma.category.findMany({ where: { name: c.name } });
    const ids = new Set([...bySlug, ...byName].map((x) => x.id));
    if (ids.size > 1 || bySlug.length > 1) { categoryResult.push({ key: c.key, action: 'conflict', diff: ['slug/name-taken'] }); categoryId[c.slug] = null; continue; }
    const row = bySlug[0] || byName[0];
    if (row) {
      const diff = [];
      if (row.slug !== c.slug) diff.push('slug');
      if (row.name !== c.name) diff.push('name');
      if (!same(row.description, c.description)) diff.push('description');
      if (!same(row.icon, c.icon)) diff.push('icon');
      categoryResult.push({ key: c.key, id: row.id, action: diff.length ? 'conflict' : 'reuse', diff });
      categoryId[c.slug] = diff.length ? null : row.id;
      continue;
    }
    if (!apply) { categoryResult.push({ key: c.key, id: null, action: 'create' }); categoryId[c.slug] = null; continue; }
    const created = await prisma.category.create({ data: { name: c.name, slug: c.slug, description: c.description, icon: c.icon } });
    categoryResult.push({ key: c.key, id: created.id, action: 'created', diff: [] });
    categoryId[c.slug] = created.id;
  }

  // ---- courses + lessons ----
  const courseResult = [];
  for (const c of courses) {
    const insId = instructors[c.instructorKey] || null;
    const catId = categoryId[c.categorySlug] || null;
    const rows = await prisma.course.findMany({ where: { slug: c.slug } });
    const lessonTally = { create: 0, created: 0, reuse: 0, conflict: 0, extra: 0 };
    if (rows.length > 1) { courseResult.push({ key: c.key, action: 'conflict', diff: ['duplicate-slug'], lessons: lessonTally }); continue; }
    let course = rows[0] || null;
    let action;
    let diff = [];
    if (course) {
      diff = courseDiff(course, c, catId, insId, adminId);
      action = diff.length ? 'conflict' : 'reuse';
    } else {
      const blockedBy = [];
      if (!insId) blockedBy.push('instructor');
      if (!catId) blockedBy.push('category');
      if (c.moderation.approvalStatus === 'APPROVED' && !adminId) blockedBy.push('admin');
      if (!apply) {
        action = blockedBy.length ? 'create-pending' : 'create';
        diff = blockedBy;
        lessonTally.create = c.lessons.length;
      } else if (blockedBy.length) {
        action = 'blocked';
        diff = blockedBy;
      } else {
        const m = c.moderation;
        try {
          course = await prisma.course.create({
            data: {
              title: c.title,
              slug: c.slug,
              description: c.description,
              instructorId: insId,
              price: c.price,
              categoryId: catId,
              level: c.level,
              language: c.language,
              whatYouWillLearn: c.whatYouWillLearn,
              requirements: c.requirements,
              targetAudience: c.targetAudience,
              published: m.published,
              approvalStatus: m.approvalStatus,
              rejectionReason: m.rejectionReason,
              approvedAt: m.approvedAt ? new Date(m.approvedAt) : null,
              approvedBy: m.approvalStatus === 'APPROVED' ? adminId : null,
              createdAt: new Date(c.createdAt),
            },
          });
          action = 'created';
        } catch (e) {
          if (e.code !== 'P2002') throw e;
          action = 'conflict';
          diff = ['created-concurrently'];
          course = null;
        }
      }
    }

    // lessons only for a course that exists and matches the fixture
    if (course && (action === 'reuse' || action === 'created')) {
      for (const l of c.lessons) {
        const lr = await prisma.lesson.findMany({ where: { courseId: course.id, order: l.order } });
        if (lr.length > 1) { lessonTally.conflict++; continue; }
        if (lr.length === 1) { lessonDiff(lr[0], l).length ? lessonTally.conflict++ : lessonTally.reuse++; continue; }
        if (!apply) { lessonTally.create++; continue; }
        try {
          await prisma.lesson.create({ data: { courseId: course.id, title: l.title, description: l.description, videoUrl: l.videoUrl, duration: l.duration, order: l.order, isPreview: l.isPreview, resources: l.resources } });
          lessonTally.created++;
        } catch (e) {
          if (e.code !== 'P2002') throw e;
          lessonTally.conflict++;
        }
      }
      lessonTally.extra = await prisma.lesson.count({ where: { courseId: course.id, order: { notIn: c.lessons.map((l) => l.order) } } });
    }

    let stored = null;
    if (course) {
      const lessons = await prisma.lesson.findMany({ where: { courseId: course.id }, orderBy: { order: 'asc' }, select: { order: true, title: true, duration: true, isPreview: true, videoUrl: true } });
      stored = {
        id: course.id, instructorId: course.instructorId, categoryId: course.categoryId, published: course.published, approvalStatus: course.approvalStatus,
        approvedBy: course.approvedBy, approvedAt: iso(course.approvedAt), rejectionReason: course.rejectionReason, price: course.price,
        rating: course.rating, totalReviews: course.totalReviews, enrolledCount: course.enrolledCount, lessons,
      };
    }
    courseResult.push({ key: c.key, id: course ? course.id : null, action, diff, lessons: lessonTally, stored });
  }

  // lessons that point to a course that does not exist (whole collection, read-only)
  const lessonCourseIds = (await prisma.lesson.findMany({ distinct: ['courseId'], select: { courseId: true } })).map((r) => r.courseId);
  const existingCourseIds = lessonCourseIds.length ? (await prisma.course.findMany({ where: { id: { in: lessonCourseIds } }, select: { id: true } })).map((r) => r.id) : [];
  const orphanCourseIds = lessonCourseIds.filter((id) => !existingCourseIds.includes(id));
  const orphanLessons = orphanCourseIds.length ? await prisma.lesson.count({ where: { courseId: { in: orphanCourseIds } } }) : 0;

  const after = await othersDigest(slugs, catSlugs);
  out({
    categories: categoryResult,
    courses: courseResult,
    indexes,
    orphanLessons,
    others: { before, after, unchanged: before.sha256 === after.sha256 },
    totals: { categories: await prisma.category.count(), courses: await prisma.course.count(), lessons: await prisma.lesson.count() },
  });
  await prisma.$disconnect();
})().catch(async (e) => {
  out({ error: String(e.message || e).replace(/mongodb(\+srv)?:\/\/\S+/g, 'mongodb://***').slice(0, 500) });
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
