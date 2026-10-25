/* eslint-disable */
// DATA-01 part for user_db (profiles, education, work). Runs with the user-service's own Prisma client, INPUT prepended.
//   mode 'plan'  : read-only. Per fixture account: profile create | reuse | conflict (+ education / work rows).
//   mode 'apply' : creates the missing profiles with the account's REAL auth userId and the role from the fixture (explicit,
//                  never guessed from the e-mail), then the missing education / work rows. Refused without the unique indexes.
// An existing profile is NEVER changed: any difference is reported as a conflict and that profile is left alone.
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();
const out = (o) => console.log('RESULT:' + JSON.stringify(o));
const DEV_DOMAIN = /@umi-demo\.local$/;
const ROLES = ['ADMIN', 'INSTRUCTOR', 'STUDENT'];

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

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00.000Z`) : null);
const sameDay = (a, b) => (a ? new Date(a).toISOString().slice(0, 10) : null) === (b ? String(b).slice(0, 10) : null);
const same = (a, b) => (a ?? null) === (b ?? null);

async function othersDigest(emails) {
  const others = await prisma.userProfile.findMany({
    where: { email: { notIn: emails } },
    orderBy: { id: 'asc' },
    select: { id: true, userId: true, email: true, fullName: true, role: true, isActive: true, bio: true, createdAt: true },
  });
  return { count: others.length, sha256: crypto.createHash('sha256').update(JSON.stringify(others)).digest('hex') };
}

function profileDiff(p, a) {
  const diff = [];
  if (!same(p.userId, a.userId)) diff.push('userId');
  if (p.email !== a.email) diff.push('email');
  if (p.role !== a.role) diff.push('role');
  if (p.fullName !== a.fullName) diff.push('fullName');
  if (p.isActive !== true) diff.push('isActive');
  if (!same(p.bio, a.bio)) diff.push('bio');
  if (!same(p.address, a.address)) diff.push('address');
  if (!sameDay(p.dateOfBirth, a.dateOfBirth)) diff.push('dateOfBirth');
  return diff;
}

// education / work rows of one profile; natural key = (institution, degree, fieldOfStudy) / (company, position, startDate)
async function subRows(profileId, a, apply) {
  const tally = { create: 0, created: 0, reuse: 0, conflict: 0 };
  for (const e of a.education) {
    const rows = await prisma.educationBackground.findMany({ where: { userId: profileId, institution: e.institution, degree: e.degree, fieldOfStudy: e.fieldOfStudy } });
    if (rows.length > 1) { tally.conflict++; continue; }
    if (rows.length === 1) {
      const r = rows[0];
      const ok = sameDay(r.startDate, e.startDate) && sameDay(r.endDate, e.endDate) && same(r.grade, e.grade) && same(r.description, e.description);
      ok ? tally.reuse++ : tally.conflict++;
      continue;
    }
    if (!apply) { tally.create++; continue; }
    await prisma.educationBackground.create({ data: { userId: profileId, institution: e.institution, degree: e.degree, fieldOfStudy: e.fieldOfStudy, startDate: day(e.startDate), endDate: day(e.endDate), grade: e.grade, description: e.description } });
    tally.created++;
  }
  const wt = { create: 0, created: 0, reuse: 0, conflict: 0 };
  for (const w of a.work) {
    const rows = await prisma.workExperience.findMany({ where: { userId: profileId, company: w.company, position: w.position, startDate: day(w.startDate) } });
    if (rows.length > 1) { wt.conflict++; continue; }
    if (rows.length === 1) {
      const r = rows[0];
      const ok = sameDay(r.endDate, w.endDate) && r.current === w.current && same(r.location, w.location) && same(r.description, w.description);
      ok ? wt.reuse++ : wt.conflict++;
      continue;
    }
    if (!apply) { wt.create++; continue; }
    await prisma.workExperience.create({ data: { userId: profileId, company: w.company, position: w.position, location: w.location, startDate: day(w.startDate), endDate: day(w.endDate), current: w.current, description: w.description } });
    wt.created++;
  }
  return { education: tally, work: wt };
}

(async () => {
  const { mode, accounts, dataset } = INPUT;
  if (mode !== 'plan' && mode !== 'apply') throw new Error(`unknown mode ${mode}`);
  for (const a of accounts) {
    if (!DEV_DOMAIN.test(a.email)) throw new Error(`refusing a non-development e-mail for ${a.key}`);
    if (!ROLES.includes(a.role)) throw new Error(`invalid role for ${a.key}`);
  }
  const indexes = [await uniqueIndexState('user_profiles', [['userId'], ['email']])];
  if (mode === 'apply' && indexes.some((i) => i.missing.length > 0)) {
    throw new Error('user_db.user_profiles has no unique index on userId/email - run the schema sync (prisma db push) first; nothing was written');
  }
  const emails = accounts.map((a) => a.email);
  const before = await othersDigest(emails);
  const result = [];

  for (const a of accounts) {
    const byEmail = await prisma.userProfile.findMany({ where: { email: a.email } });
    const byUser = a.userId ? await prisma.userProfile.findMany({ where: { userId: a.userId } }) : [];
    const ids = new Set([...byEmail, ...byUser].map((p) => p.id));
    if (ids.size > 1 || byEmail.length > 1 || byUser.length > 1) {
      result.push({ key: a.key, userId: a.userId, profileId: null, action: 'conflict', diff: ['duplicate-profile'] });
      continue;
    }
    const p = byEmail[0] || byUser[0];
    if (p) {
      const diff = profileDiff(p, a);
      if (diff.length) { result.push({ key: a.key, userId: p.userId, profileId: p.id, role: p.role, isActive: p.isActive, action: 'conflict', diff }); continue; }
      const sub = await subRows(p.id, a, mode === 'apply');
      const subConflicts = sub.education.conflict + sub.work.conflict;
      result.push({ key: a.key, userId: p.userId, profileId: p.id, role: p.role, isActive: p.isActive, action: 'reuse', diff: subConflicts ? ['education/work'] : [], sub });
      continue;
    }
    if (mode !== 'apply' || !a.userId) {
      result.push({ key: a.key, userId: a.userId || null, profileId: null, action: a.userId ? 'create' : 'create-pending-account', sub: { education: { create: a.education.length }, work: { create: a.work.length } } });
      continue;
    }
    let created;
    try {
      created = await prisma.userProfile.create({
        data: {
          userId: a.userId,
          email: a.email,
          fullName: a.fullName,
          role: a.role,
          bio: a.bio,
          address: a.address,
          dateOfBirth: day(a.dateOfBirth),
          preferences: { language: 'vi', devData: dataset },
        },
      });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
      result.push({ key: a.key, userId: a.userId, profileId: null, action: 'conflict', diff: ['created-concurrently'] });
      continue;
    }
    const sub = await subRows(created.id, a, true);
    result.push({ key: a.key, userId: created.userId, profileId: created.id, role: created.role, isActive: created.isActive, action: 'created', diff: [], sub });
  }

  const after = await othersDigest(emails);
  out({ profiles: result, indexes, others: { before, after, unchanged: before.sha256 === after.sha256 }, total: await prisma.userProfile.count() });
  await prisma.$disconnect();
})().catch(async (e) => {
  out({ error: String(e.message || e).replace(/mongodb(\+srv)?:\/\/\S+/g, 'mongodb://***').slice(0, 500) });
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
