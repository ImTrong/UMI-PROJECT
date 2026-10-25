// DATA-01 end to end on an ISOLATED MongoDB (throw-away replica set on 127.0.0.1:27098, temp data dir) - never the Docker one.
// The parts run exactly as in production, only with --target=local (cwd = the service, its own generated Prisma client).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSeed, runVerify } from '../lib/seed.mjs';
import { loadFixtures } from '../lib/fixtures.mjs';
import { REPO, url, startMongod, dbPush, raw, rawOne, findAll, count, dbHash } from './helpers/isolated-mongo.mjs';

const PORT = Number(process.env.DEV_DATA_TEST_PORT || 27098);
const fx = loadFixtures();
const LESSONS = fx.courses.reduce((n, c) => n + c.lessons.length, 0);
const oidOf = (v) => (v && typeof v === 'object' && v.$oid ? v.$oid : v);
const tmp = mkdtempSync(path.join(tmpdir(), 'umi-data01-it-'));

const envFor = (set, port = PORT, extra = '') => ({
  ...process.env,
  DEV_DATA_AUTH_DB_URL: url(port, `auth_${set}`, extra),
  DEV_DATA_USER_DB_URL: url(port, `user_${set}`, extra),
  DEV_DATA_COURSE_DB_URL: url(port, `course_${set}`, extra),
  DEV_DATA_CREDENTIALS_FILE: path.join(tmp, `accounts-${set}.local.json`),
  BCRYPT_ROUNDS: '4',
});
const dbs = (set) => [url(PORT, `auth_${set}`), url(PORT, `user_${set}`), url(PORT, `course_${set}`)];
const hashes = async (set) => Promise.all(dbs(set).map(dbHash));

// data that exists before the seed and must never change (like the two accounts of the Docker DB)
const EXISTING = {
  adminId: '6a0000000000000000000001',
  instructorId: '6a0000000000000000000002',
  courseId: '6a0000000000000000000003',
};
async function insertExisting(set) {
  const [a, u, c] = dbs(set);
  const d = { $date: '2026-10-24T09:00:00.000Z' };
  await rawOne(a, { insert: 'users', documents: [
    { _id: { $oid: EXISTING.adminId }, email: 'admin@elearning.local', password: '$2a$10$existinghashexistinghashexistinghashexistinghashexist', fullName: 'System Administrator', emailVerified: true, isActive: true, createdAt: d, updatedAt: d },
    { _id: { $oid: EXISTING.instructorId }, email: 'teacher@elearning.local', password: '$2a$10$existinghashexistinghashexistinghashexistinghashexis2', fullName: 'Existing Teacher', emailVerified: false, isActive: true, createdAt: d, updatedAt: d },
  ] });
  await rawOne(u, { insert: 'user_profiles', documents: [
    { userId: { $oid: EXISTING.instructorId }, email: 'teacher@elearning.local', fullName: 'Existing Teacher', role: 'INSTRUCTOR', badges: [], preferences: {}, isActive: true, createdAt: d, updatedAt: d },
  ] });
  await rawOne(c, { insert: 'courses', documents: [
    { _id: { $oid: EXISTING.courseId }, title: 'Existing course', slug: 'existing-course', description: 'A course that existed before DATA-01.', instructorId: { $oid: EXISTING.instructorId }, price: 100000, level: 'BEGINNER', language: 'Vietnamese', requirements: [], targetAudience: [], published: false, approvalStatus: 'DRAFT', rating: 0, totalReviews: 0, enrolledCount: 0, createdAt: d, updatedAt: d },
  ] });
  await rawOne(c, { insert: 'lessons', documents: [
    { courseId: { $oid: EXISTING.courseId }, title: 'Existing lesson', videoUrl: '', duration: 60, order: 0, isPreview: false, resources: [], createdAt: d, updatedAt: d },
  ] });
}
async function existingSnapshot(set) {
  const [a, u, c] = dbs(set);
  return {
    users: await findAll(a, 'users', { email: { $in: ['admin@elearning.local', 'teacher@elearning.local'] } }),
    profiles: await findAll(u, 'user_profiles', { email: 'teacher@elearning.local' }),
    courses: await findAll(c, 'courses', { slug: 'existing-course' }),
    lessons: await findAll(c, 'lessons', { courseId: { $oid: EXISTING.courseId } }),
  };
}

let mongod;
before(async () => {
  mongod = await startMongod(PORT);
  for (const set of ['a', 'b']) {
    await dbPush('auth-service', url(PORT, `auth_${set}`));
    await dbPush('user-service', url(PORT, `user_${set}`));
    await dbPush('course-service', url(PORT, `course_${set}`));
  }
  await insertExisting('a');
}, { timeout: 300_000 });

after(async () => {
  if (mongod) await mongod.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('without the unique indexes: dry-run reports them, apply is refused, nothing is written', { timeout: 120_000 }, async () => {
  const env = envFor('c');
  const dry = await runSeed({ target: 'local', env });
  assert.ok(dry.summary.missingIndexes.length >= 4, JSON.stringify(dry.summary.missingIndexes));
  await assert.rejects(runSeed({ apply: true, target: 'local', env }), /unique indexes are missing/);
  for (const h of await hashes('c')) assert.deepEqual(h, {});
  assert.equal(existsSync(env.DEV_DATA_CREDENTIALS_FILE), false);
});

test('dry-run writes nothing and plans the whole fixture', { timeout: 120_000 }, async () => {
  const before = await hashes('a');
  const res = await runSeed({ target: 'local', env: envFor('a') });
  assert.deepEqual(await hashes('a'), before);
  assert.equal(res.mode, 'dry-run');
  assert.deepEqual(res.summary.accounts, { create: 46 });
  assert.deepEqual(res.summary.profiles, { 'create-pending-account': 46 });
  assert.deepEqual(res.summary.categories, { create: 6 });
  assert.deepEqual(res.summary.courses, { 'create-pending': 30 });
  assert.equal(res.summary.lessons.create, LESSONS);
  assert.deepEqual(res.summary.missingIndexes, []);
  assert.deepEqual(res.summary.conflicts, []);
  assert.deepEqual(res.consistency.errors, []);
  assert.equal(existsSync(envFor('a').DEV_DATA_CREDENTIALS_FILE), false);
});

test('apply (CLI) creates every record, linked across services, without touching existing data or printing secrets', { timeout: 180_000 }, async () => {
  const env = envFor('a');
  const existingBefore = await existingSnapshot('a');
  const cli = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev-data', 'seed-dev-data.mjs'), '--apply', '--target=local'], { env, encoding: 'utf8', timeout: 170_000 });
  const output = `${cli.stdout}\n${cli.stderr}`;
  assert.equal(cli.status, 0, output.slice(-1500));

  // secrets: the local file only
  const creds = JSON.parse(readFileSync(env.DEV_DATA_CREDENTIALS_FILE, 'utf8'));
  assert.equal(creds.accounts.length, 46);
  for (const a of creds.accounts) assert.ok(!output.includes(a.password), 'a password was printed');
  assert.doesNotMatch(output, /\$2[aby]\$/);

  const [A, U, C] = dbs('a');
  assert.equal(await count(A, 'users'), 48);
  assert.equal(await count(U, 'user_profiles'), 47);
  assert.equal(await count(C, 'categories'), 6);
  assert.equal(await count(C, 'courses'), 31);
  assert.equal(await count(C, 'lessons'), LESSONS + 1);
  assert.deepEqual(await existingSnapshot('a'), existingBefore);

  // account <-> profile: same userId, explicit role from the fixture
  const users = await findAll(A, 'users', { email: { $regex: '@umi-demo\\.local$' } });
  const profiles = await findAll(U, 'user_profiles', { email: { $regex: '@umi-demo\\.local$' } });
  const idByEmail = new Map(users.map((x) => [x.email, oidOf(x._id)]));
  for (const a of fx.accounts) {
    const p = profiles.find((x) => x.email === a.email);
    assert.ok(p, a.key);
    assert.equal(oidOf(p.userId), idByEmail.get(a.email), `${a.key} userId`);
    assert.equal(p.role, a.role, `${a.key} role`);
  }
  assert.equal(await count(U, 'education_backgrounds'), fx.accounts.reduce((n, a) => n + (a.education || []).length, 0));
  assert.equal(await count(U, 'work_experiences'), fx.accounts.reduce((n, a) => n + (a.work || []).length, 0));

  // the stored hash is a bcryptjs hash of the password kept in the local file
  const bcrypt = createRequire(path.join(REPO, 'services', 'auth-service', 'package.json'))('bcryptjs');
  const one = users.find((x) => x.email === creds.accounts[3].email);
  assert.equal(bcrypt.compareSync(creds.accounts[3].password, one.password), true);

  // courses: owner = instructor account, approvedBy = admin account, statuses, no invented aggregates
  const courses = await findAll(C, 'courses', { slug: { $ne: 'existing-course' } });
  const insIds = new Set(fx.accounts.filter((a) => a.role === 'INSTRUCTOR').map((a) => idByEmail.get(a.email)));
  const adminId = idByEmail.get(fx.accounts.find((a) => a.role === 'ADMIN').email);
  for (const c of courses) {
    const f = fx.courses.find((x) => x.slug === c.slug);
    assert.equal(oidOf(c.instructorId), idByEmail.get(fx.accounts.find((a) => a.key === f.instructorKey).email), c.slug);
    assert.ok(insIds.has(oidOf(c.instructorId)));
    assert.equal(c.approvalStatus, f.status);
    assert.equal(c.published, f.status === 'APPROVED');
    if (f.status === 'APPROVED') assert.equal(oidOf(c.approvedBy), adminId);
    assert.equal(c.rating, 0);
    assert.equal(c.enrolledCount, 0);
    assert.equal(c.totalReviews, 0);
  }
  const statusCount = (s) => courses.filter((c) => c.approvalStatus === s).length;
  assert.deepEqual([statusCount('APPROVED'), statusCount('PENDING_REVIEW'), statusCount('DRAFT'), statusCount('REJECTED')], [20, 4, 3, 3]);

  // the verify CLI agrees
  const verify = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev-data', 'verify-consistency.mjs'), '--target=local', '--complete'], { env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(verify.status, 0, verify.stdout + verify.stderr);
  assert.match(verify.stdout, /consistent/);
});

test('re-running apply creates nothing, changes nothing and keeps the credentials file', { timeout: 180_000 }, async () => {
  const env = envFor('a');
  const credsBefore = readFileSync(env.DEV_DATA_CREDENTIALS_FILE, 'utf8');
  const before = await hashes('a');
  const res = await runSeed({ apply: true, target: 'local', env });
  assert.deepEqual(res.applied.accounts, { reuse: 46 });
  assert.deepEqual(res.applied.profiles, { reuse: 46 });
  assert.deepEqual(res.applied.categories, { reuse: 6 });
  assert.deepEqual(res.applied.courses, { reuse: 30 });
  assert.equal(res.summary.lessons.reuse, LESSONS);
  assert.deepEqual(res.consistency.errors, []);
  assert.deepEqual(await hashes('a'), before);
  assert.equal(readFileSync(env.DEV_DATA_CREDENTIALS_FILE, 'utf8'), credsBefore);
});

test('a stored record that differs from the fixture is reported as a conflict and never overwritten', { timeout: 180_000 }, async () => {
  const env = envFor('a');
  const [, U, C] = dbs('a');
  const slug = fx.courses.find((c) => c.key === 'FE_REACT_TS').slug;
  const stu = fx.accounts.find((a) => a.key === 'STU_07');
  await rawOne(C, { update: 'courses', updates: [{ q: { slug }, u: { $set: { title: 'Tiêu đề do giảng viên sửa' } } }] });
  await rawOne(U, { update: 'user_profiles', updates: [{ q: { email: stu.email }, u: { $set: { bio: 'Hồ sơ do học viên tự cập nhật.' } } }] });
  const before = await hashes('a');

  const res = await runSeed({ apply: true, target: 'local', env });
  assert.ok(res.summary.conflicts.some((c) => /course FE_REACT_TS: title/.test(c)), JSON.stringify(res.summary.conflicts));
  assert.ok(res.summary.conflicts.some((c) => /profile STU_07: bio/.test(c)));
  assert.deepEqual(await hashes('a'), before, 'apply changed something after a conflict');
  assert.equal((await findAll(C, 'courses', { slug }))[0].title, 'Tiêu đề do giảng viên sửa');
  assert.equal((await findAll(U, 'user_profiles', { email: stu.email }))[0].bio, 'Hồ sơ do học viên tự cập nhật.');

  const v = await runVerify({ target: 'local', env, expectComplete: true });
  assert.ok(v.consistency.errors.some((e) => /FE_REACT_TS/.test(e)));
});

test('an account conflict stops that account and only what depends on it', { timeout: 180_000 }, async () => {
  const env = envFor('b');
  const [A, U, C] = dbs('b');
  const ins = fx.accounts.find((a) => a.key === 'INS_05');
  await rawOne(A, { insert: 'users', documents: [{ email: ins.email, password: '$2a$10$someoneelsesomeoneelsesomeoneelsesomeoneelsesomeoneel', fullName: 'Someone Else', emailVerified: true, isActive: true, createdAt: { $date: '2026-10-01T00:00:00Z' }, updatedAt: { $date: '2026-10-01T00:00:00Z' } }] });

  const res = await runSeed({ apply: true, target: 'local', env });
  assert.deepEqual(res.applied.accounts, { created: 45, conflict: 1 });
  assert.equal(await count(U, 'user_profiles', { email: ins.email }), 0, 'no profile for a conflicting account');
  const own = fx.courses.filter((c) => c.instructorKey === 'INS_05');
  assert.equal(res.summary.blocked.length, own.length);
  assert.equal(await count(C, 'courses'), 30 - own.length);
  assert.equal((await findAll(A, 'users', { email: ins.email }))[0].fullName, 'Someone Else');
});

test('an unreachable database stops before anything is written', { timeout: 120_000 }, async () => {
  const env = envFor('d', 27096, '&connectTimeoutMS=1500');
  await assert.rejects(runSeed({ apply: true, target: 'local', env }), /read-only check failed, nothing was written/);
  assert.equal(existsSync(env.DEV_DATA_CREDENTIALS_FILE), false);
  const [res] = await raw(url(PORT, 'admin'), [{ listDatabases: 1, nameOnly: true }]);
  assert.ok(!res.r.databases.some((d) => d.name.endsWith('_d')));
});
