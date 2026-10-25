#!/usr/bin/env node
/**
 * Demo data for the monthly learner leaderboard (FIX DEMO RANKING 02C.4), on the CURRENT Docker stack (elearning-* containers).
 *
 *   node scripts/demo-seed/seed-ranking-demo.mjs            dry run (default): reads, checks and prints the plan; writes nothing
 *   node scripts/demo-seed/seed-ranking-demo.mjs --apply    creates the missing demo data, then verifies it
 *
 * What it creates (and nothing else), each step idempotent - a second run reuses what exists:
 *   - 3 demo login accounts (auth_db.users, unique email) and their learner profiles (user_db.user_profiles, same userId, STUDENT)
 *   - their course completion records (learning_db, unique [userId, courseId]) through AchievementService.recordCourseCompletion,
 *     so points, level multiplier, VALID status and the Vietnam-time period come from the service itself (policy v1.1)
 *       * current period 10/2026: for the live ranking
 *       * history period 03/2026: ended and outside the 6-month auto-finalize window, for the admin's manual finalize
 *   - an EMPTY reward wallet per demo learner (balance 0), as ensureWallet would create it
 * It never finalizes, adjusts points, flags, redeems, writes ledger entries or touches a record that is not demo data; the
 * completion flow of the app is NOT used (it could issue a blockchain certificate). Each part runs inside its own container with
 * that container's Prisma client and DATABASE_URL (no connection string leaves Docker).
 *
 * Demo passwords are generated on first creation and kept ONLY in scripts/demo-seed/.env.demo-accounts.local
 * (git-ignored by the `.env.*.local` rule). They are never printed. An existing account keeps its password.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_FILE = path.join(HERE, '.env.demo-accounts.local');
const APPLY = process.argv.includes('--apply');
const GATEWAY = process.env.UMI_GATEWAY_URL || 'http://localhost:8080';

const CURRENT = { month: 10, year: 2026 };
const HISTORY = { month: 3, year: 2026 };
/** the history period must be at least this many months back, or the startup catch-up / reconcile (6 months) would finalize it */
const MIN_MONTHS_BACK = 7;

const ACCOUNTS = [
  { key: 'DEMO_STUDENT_1', email: 'minhanh.demo@umi-demo.local', fullName: 'Nguyễn Minh Anh' },
  { key: 'DEMO_STUDENT_2', email: 'giabao.demo@umi-demo.local', fullName: 'Trần Gia Bảo' },
  { key: 'DEMO_STUDENT_3', email: 'thuha.demo@umi-demo.local', fullName: 'Lê Thu Hà' },
];

// APPROVED + published courses of the current course_db (durations and levels decide the points; nothing is forced)
const C = {
  DOCKER: '6ad1827b39977309d5ae8f77', // BEGINNER, 60 min
  NODE: '6ad180da1db86f9327a18f53', // INTERMEDIATE, 15 min
  NEXT: '6ad180da1db86f9327a18f56', // ADVANCED, 15 min
  DSA: '6ad180da1db86f9327a18f5f', // ADVANCED, 15 min
  MOBILE: '6ad180da1db86f9327a18f5c', // INTERMEDIATE, 15 min
  SPRING: '6ad180da1db86f9327a18f65', // ADVANCED, 15 min
  GO: '6ad180da1db86f9327a18f68', // INTERMEDIATE, 15 min
  FIGMA: '6ad180da1db86f9327a18f6e', // BEGINNER, 15 min
  BLENDER: '6ad180db1db86f9327a18f7a', // ADVANCED, 15 min
  IELTS: '6ad180dc1db86f9327a18fa4', // ADVANCED, 15 min
  GA4: '6ad180db1db86f9327a18f8f', // ADVANCED, 15 min
  LEADERSHIP: '6ad180dc1db86f9327a18fc5', // ADVANCED, 15 min
  NEGOTIATION: '6ad180dc1db86f9327a18fc2', // ADVANCED, 15 min
  SEO: '6ad180db1db86f9327a18f83', // INTERMEDIATE, 15 min
};

/** completions per demo learner: [course, completedAt (Vietnam time)]; a course appears at most once per learner */
const PLAN = {
  DEMO_STUDENT_1: {
    current: [[C.DOCKER, '2026-10-06T09:15:00+07:00'], [C.NEXT, '2026-10-12T20:30:00+07:00'], [C.DSA, '2026-10-19T21:00:00+07:00']],
    history: [[C.BLENDER, '2026-03-10T09:00:00+07:00'], [C.IELTS, '2026-03-18T20:15:00+07:00']],
  },
  DEMO_STUDENT_2: {
    current: [[C.DOCKER, '2026-10-08T08:00:00+07:00'], [C.NODE, '2026-10-17T22:10:00+07:00']],
    history: [[C.GA4, '2026-03-05T08:30:00+07:00'], [C.LEADERSHIP, '2026-03-14T19:45:00+07:00'], [C.NEGOTIATION, '2026-03-27T21:10:00+07:00']],
  },
  DEMO_STUDENT_3: {
    current: [[C.SPRING, '2026-10-03T19:00:00+07:00'], [C.GO, '2026-10-09T20:00:00+07:00'], [C.MOBILE, '2026-10-15T07:45:00+07:00'], [C.FIGMA, '2026-10-21T18:30:00+07:00']],
    history: [[C.SEO, '2026-03-21T10:20:00+07:00']],
  },
};

// ─── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function runPart(container, file, input) {
  const source = readFileSync(path.join(HERE, 'parts', file), 'utf8');
  const r = spawnSync('docker', ['exec', '-i', container, 'node', '-'], {
    input: `const INPUT = ${JSON.stringify(input)};\n${source}`,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  const line = (r.stdout || '').split('\n').reverse().find((l) => l.startsWith('RESULT:'));
  if (!line) throw new Error(`${container}/${file}: no result (exit ${r.status}): ${(r.stderr || '').split('\n').slice(-3).join(' ').slice(0, 300)}`);
  const result = JSON.parse(line.slice('RESULT:'.length));
  if (result.error) throw new Error(`${container}/${file}: ${result.error}`);
  return result;
}

const vnPeriod = (iso) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: 'numeric' }).formatToParts(new Date(iso));
  return { month: Number(parts.find((p) => p.type === 'month').value), year: Number(parts.find((p) => p.type === 'year').value) };
};
const round2 = (n) => Math.round(n * 100) / 100;

function readCredentials() {
  const map = {};
  if (!existsSync(CREDENTIALS_FILE)) return map;
  for (const line of readFileSync(CREDENTIALS_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function writeCredentials(map) {
  const lines = [
    '# UMI leaderboard demo accounts (FIX DEMO RANKING 02C.4). LOCAL ONLY - git-ignored (.env.*.local). Do not commit or share.',
    '# Learner frontend: http://localhost:3000  (admin frontend: http://localhost:4000 with the existing admin account)',
  ];
  for (const a of ACCOUNTS) {
    lines.push(`${a.key}_NAME=${a.fullName}`, `${a.key}_EMAIL=${a.email}`);
    if (map[`${a.key}_PASSWORD`]) lines.push(`${a.key}_PASSWORD=${map[`${a.key}_PASSWORD`]}`);
  }
  writeFileSync(CREDENTIALS_FILE, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
}

const fail = (msg) => { console.error(`\nSTOP: ${msg}\nNothing was written by this step.`); process.exit(2); };

// ─── 1. read-only checks ────────────────────────────────────────────────────────────────────────────────────────────────

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
const authPlan = runPart('elearning-auth-service', 'auth.cjs', { mode: 'plan', accounts: ACCOUNTS.map(({ key, email, fullName }) => ({ key, email, fullName })) });
const idOf = Object.fromEntries(authPlan.accounts.map((a) => [a.key, a.id]));
for (const a of authPlan.accounts) if (a.action === 'reuse' && a.isActive !== true) fail(`existing account ${a.key} is not active`);
const userPlan = runPart('elearning-user-service', 'user.cjs', { mode: 'plan', accounts: ACCOUNTS.map((a) => ({ ...a, userId: idOf[a.key] })) });

const courseIds = [...new Set(Object.values(PLAN).flatMap((p) => [...p.current, ...p.history].map(([c]) => c)))];
const demoIds = Object.values(idOf).filter(Boolean);
const probe = runPart('elearning-learning-service', 'learning.cjs', { mode: 'probe', demoUserIds: demoIds, periods: [CURRENT, HISTORY], courseIds });

if (probe.now.month !== CURRENT.month || probe.now.year !== CURRENT.year) {
  fail(`the running period is ${probe.now.month}/${probe.now.year}, but the plan is written for ${CURRENT.month}/${CURRENT.year}; update CURRENT and the dates`);
}
const [cur, hist] = probe.periods;
if (cur.state !== 'CURRENT') fail(`${CURRENT.month}/${CURRENT.year} is not the running period (${cur.state})`);
if (hist.state !== 'ENDED') fail(`${HISTORY.month}/${HISTORY.year} has not ended (${hist.state})`);
const monthsBack = probe.now.year * 12 + probe.now.month - (HISTORY.year * 12 + HISTORY.month);
if (monthsBack < MIN_MONTHS_BACK) fail(`${HISTORY.month}/${HISTORY.year} is only ${monthsBack} months back: the automatic catch-up would finalize it`);
if (hist.board) fail(`${HISTORY.month}/${HISTORY.year} already has a leaderboard row (${hist.board.status}); choose another ended, unfinalized period`);
if (hist.entries > 0) fail(`${HISTORY.month}/${HISTORY.year} already has snapshot entries`);
const demoInHistory = probe.existingDemo.filter((r) => r.month === HISTORY.month && r.year === HISTORY.year).length;
const otherInHistory = Object.values(hist.records).reduce((s, n) => s + n, 0) - demoInHistory;
if (otherInHistory > 0) fail(`${HISTORY.month}/${HISTORY.year} already holds ${otherInHistory} completion record(s) of other users`);

for (const id of courseIds) {
  const m = probe.metadata[id];
  if (!m || !m.valid || m.approvalStatus !== 'APPROVED') fail(`course ${id} is not an APPROVED course with a valid duration (${JSON.stringify(m)})`);
}

// planned completions, with what already exists for the demo ids
const planned = [];
for (const a of ACCOUNTS) {
  for (const [which, list] of [['current', PLAN[a.key].current], ['history', PLAN[a.key].history]]) {
    const target = which === 'current' ? CURRENT : HISTORY;
    for (const [courseId, completedAt] of list) {
      const p = vnPeriod(completedAt);
      if (p.month !== target.month || p.year !== target.year) fail(`${a.key}: ${completedAt} is not in ${target.month}/${target.year} (Vietnam time)`);
      if (new Date(completedAt).getTime() > Date.now()) fail(`${a.key}: ${completedAt} is in the future`);
      const existing = probe.existingDemo.find((r) => r.userId === idOf[a.key] && r.courseId === courseId);
      if (existing && (existing.month !== target.month || existing.year !== target.year)) fail(`${a.key}: existing record for ${courseId} is in ${existing.month}/${existing.year}, not ${target.month}/${target.year}`);
      planned.push({ key: a.key, which, courseId, completedAt, title: probe.metadata[courseId].title, points: probe.metadata[courseId].points, exists: !!existing });
    }
  }
}

// expected points per period (from the service's own calculation) must give distinct, readable ranks
const totals = (which) =>
  ACCOUNTS.map((a) => {
    const rows = planned.filter((p) => p.key === a.key && p.which === which);
    return { name: a.fullName, key: a.key, courses: rows.length, points: round2(rows.reduce((s, r) => s + r.points, 0)) };
  }).sort((x, y) => y.points - x.points);
for (const which of ['current', 'history']) {
  const t = totals(which);
  if (new Set(t.map((r) => r.points)).size !== t.length) fail(`expected ${which} points are not distinct: ${JSON.stringify(t)}`);
}

const walletExists = new Set(probe.demoWallets.map((w) => w.userId));
const summary = {
  accounts: { create: authPlan.accounts.filter((a) => a.action === 'create').length, reuse: authPlan.accounts.filter((a) => a.action === 'reuse').length },
  profiles: { create: userPlan.profiles.filter((p) => p.action === 'create').length, reuse: userPlan.profiles.filter((p) => p.action === 'reuse').length },
  completions: { create: planned.filter((p) => !p.exists).length, reuse: planned.filter((p) => p.exists).length },
  wallets: { create: ACCOUNTS.filter((a) => !idOf[a.key] || !walletExists.has(idOf[a.key])).length, reuse: ACCOUNTS.filter((a) => idOf[a.key] && walletExists.has(idOf[a.key])).length },
  courseProgress: { create: 0, note: 'not created: the ranking reads completion records only' },
};

console.log('\nPeriods:');
console.log(`  current ${cur.month}/${cur.year}: ${cur.state}, leaderboard row ${cur.board ? cur.board.status : 'none'}, records ${JSON.stringify(cur.records)}`);
console.log(`  history ${hist.month}/${hist.year}: ${hist.state}, ${monthsBack} months back, leaderboard row ${hist.board ? hist.board.status : 'none'}, records ${JSON.stringify(hist.records)}`);
console.log('\nPlan (create / reuse):', JSON.stringify(summary));
for (const which of ['current', 'history']) {
  const t = totals(which);
  console.log(`\nExpected ${which === 'current' ? `${CURRENT.month}/${CURRENT.year} (live)` : `${HISTORY.month}/${HISTORY.year} (to finalize)`}:`);
  t.forEach((r, i) => console.log(`  ${i + 1}. ${r.name}: ${r.points} points, ${r.courses} course(s)`));
}
console.log('\nCourses used:');
for (const id of courseIds) {
  const m = probe.metadata[id];
  console.log(`  ${id}  ${m.level.padEnd(12)} ${String(Math.round(m.seconds / 60)).padStart(3)} min  ${m.points} pts  ${m.title}`);
}
console.log('\nBaseline learning_db counts:', JSON.stringify(probe.snapshot.counts));

if (!APPLY) {
  console.log('\nDry run finished: nothing was written. Re-run with --apply to create the demo data.');
  process.exit(0);
}

// ─── 2. apply ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const creds = readCredentials();
for (const a of authPlan.accounts) {
  if (a.action === 'create' && !creds[`${a.key}_PASSWORD`]) creds[`${a.key}_PASSWORD`] = randomBytes(12).toString('base64url');
}
writeCredentials(creds); // saved BEFORE the accounts are created, so a created account never has an unknown password

const authApplied = runPart('elearning-auth-service', 'auth.cjs', {
  mode: 'apply',
  accounts: ACCOUNTS.map(({ key, email, fullName }) => ({ key, email, fullName, password: creds[`${key}_PASSWORD`] })),
});
const ids = Object.fromEntries(authApplied.accounts.map((a) => [a.key, a.id]));
const userApplied = runPart('elearning-user-service', 'user.cjs', { mode: 'apply', accounts: ACCOUNTS.map((a) => ({ ...a, userId: ids[a.key] })) });
const learningApplied = runPart('elearning-learning-service', 'learning.cjs', {
  mode: 'apply',
  demoUserIds: Object.values(ids),
  completions: planned.map((p) => ({ userId: ids[p.key], courseId: p.courseId, completedAt: p.completedAt, title: p.title })),
});

const bad = learningApplied.results.filter((r) => r.status !== 'VALID');
console.log('\nApplied:');
console.log('  accounts:', JSON.stringify(authApplied.accounts.map((a) => `${a.key}:${a.action}`)));
console.log('  profiles:', JSON.stringify(userApplied.profiles.map((p) => `${p.key}:${p.action}`)));
console.log('  completions created:', learningApplied.results.filter((r) => r.created).length, 'reused:', learningApplied.results.filter((r) => !r.created).length, 'not VALID:', bad.length);
console.log('  wallets created:', learningApplied.wallets.filter((w) => w.created).length, 'reused:', learningApplied.wallets.filter((w) => !w.created).length, 'balances:', JSON.stringify(learningApplied.wallets.map((w) => w.balance)));

// ─── 3. verify (read-only) ──────────────────────────────────────────────────────────────────────────────────────────────

const after = runPart('elearning-learning-service', 'learning.cjs', { mode: 'probe', demoUserIds: Object.values(ids), periods: [CURRENT, HISTORY], courseIds: [] });
const authAfter = runPart('elearning-auth-service', 'auth.cjs', {
  mode: 'plan',
  accounts: ACCOUNTS.map(({ key, email, fullName }) => ({ key, email, fullName })),
  verify: ACCOUNTS.filter((a) => creds[`${a.key}_PASSWORD`]).map((a) => ({ key: a.key, email: a.email, password: creds[`${a.key}_PASSWORD`] })),
});
const userAfter = runPart('elearning-user-service', 'user.cjs', { mode: 'plan', accounts: ACCOUNTS.map((a) => ({ ...a, userId: ids[a.key] })) });

// a second read after the writes: the digests must be stable, not only equal once
const afterAgain = runPart('elearning-learning-service', 'learning.cjs', { mode: 'probe', demoUserIds: Object.values(ids), periods: [], courseIds: [] }).snapshot.digests;
console.log('\nVerification:');
console.log('  learning_db counts before:', JSON.stringify(probe.snapshot.counts));
console.log('  learning_db counts after :', JSON.stringify(after.snapshot.counts));
console.log('  non-demo learning data unchanged:', JSON.stringify(Object.fromEntries(Object.keys(probe.snapshot.digests).map((k) => [k, probe.snapshot.digests[k] === after.snapshot.digests[k] && after.snapshot.digests[k] === afterAgain[k]]))));
console.log('  non-demo auth accounts unchanged:', authPlan.othersDigest === authAfter.othersDigest, '| non-demo profiles unchanged:', userPlan.othersDigest === userAfter.othersDigest);
console.log('  stored password accepted (bcrypt compare, no login):', JSON.stringify(authAfter.checks));
console.log(`  history ${HISTORY.month}/${HISTORY.year}:`, JSON.stringify(after.periods[1]), '| current:', JSON.stringify(after.periods[0].records));

for (const [label, url] of [
  [`live ${CURRENT.month}/${CURRENT.year}`, `${GATEWAY}/api/learning/leaderboard/current`],
  [`history ${HISTORY.month}/${HISTORY.year} (preview)`, `${GATEWAY}/api/learning/leaderboard/history?month=${HISTORY.month}&year=${HISTORY.year}`],
]) {
  try {
    const r = await fetch(url);
    const d = (await r.json())?.data;
    console.log(`  ${label}: HTTP ${r.status} status=${d?.status}`);
    for (const e of d?.entries ?? []) console.log(`    #${e.rank}${e.isTie ? '=' : ''} ${e.fullName}: ${e.points} pts, ${e.completedCourses} course(s), reward ${e.rewardPoints}`);
  } catch (e) {
    console.log(`  ${label}: could not read (${e.message})`);
  }
}
console.log(`\nDemo account e-mails and passwords: ${path.relative(process.cwd(), CREDENTIALS_FILE)} (local only, git-ignored).`);
