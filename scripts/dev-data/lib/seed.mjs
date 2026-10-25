// DATA-01 orchestration: plan (read-only) -> [apply] -> verify. Used by seed-dev-data.mjs, verify-consistency.mjs and the tests.
import { DATASET, loadFixtures, validateFixtures, buildPartInputs, statusFields } from './fixtures.mjs';
import { runPart } from './runner.mjs';
import { credentialsFile, passwordsFor } from './credentials.mjs';
import { checkConsistency } from './consistency.mjs';

export class StopError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StopError';
  }
}

const tally = (rows, field = 'action') => rows.reduce((t, r) => ((t[r[field]] = (t[r[field]] || 0) + 1), t), {});

/** Instructor / admin ids that may own or approve a course: auth account and profile both present, same userId, right role. */
function verifiedIds(fx, authRes, userRes) {
  const auth = new Map(authRes.accounts.map((a) => [a.key, a]));
  const prof = new Map(userRes.profiles.map((p) => [p.key, p]));
  const instructors = {};
  let adminId = null;
  for (const a of fx.accounts) {
    const au = auth.get(a.key);
    const pr = prof.get(a.key);
    const ok = au && ['reuse', 'created'].includes(au.action) && pr && ['reuse', 'created'].includes(pr.action) && pr.userId === au.id && pr.role === a.role && pr.isActive === true;
    if (!ok) continue;
    if (a.role === 'INSTRUCTOR') instructors[a.key] = au.id;
    if (a.role === 'ADMIN') adminId = au.id;
  }
  return { instructors, adminId };
}

function courseInputs(inputs, adminId) {
  return inputs.courses.map((c) => ({ ...c, moderation: statusFields(c, adminId) }));
}

async function planAll(fx, inputs, opts) {
  const auth = await runPart('auth', { mode: 'plan', accounts: inputs.accounts.map(({ key, email, fullName }) => ({ key, email, fullName })) }, opts);
  const idOf = Object.fromEntries(auth.accounts.filter((a) => a.action !== 'conflict').map((a) => [a.key, a.id]));
  const user = await runPart('user', { mode: 'plan', dataset: DATASET, accounts: inputs.accounts.map((a) => ({ ...a, userId: idOf[a.key] || null })) }, opts);
  const { instructors, adminId } = verifiedIds(fx, auth, user);
  const course = await runPart('course', { mode: 'plan', adminId, instructors, categories: inputs.categories, courses: courseInputs(inputs, adminId) }, opts);
  return { auth, user, course };
}

export function summarize({ auth, user, course }) {
  const lessons = course.courses.reduce((t, c) => {
    for (const [k, v] of Object.entries(c.lessons || {})) t[k] = (t[k] || 0) + v;
    return t;
  }, {});
  const sub = user.profiles.reduce((t, p) => {
    for (const kind of ['education', 'work']) for (const [k, v] of Object.entries((p.sub && p.sub[kind]) || {})) t[`${kind}.${k}`] = (t[`${kind}.${k}`] || 0) + v;
    return t;
  }, {});
  const conflicts = [
    ...auth.accounts.filter((a) => a.action === 'conflict').map((a) => `account ${a.key}: ${a.diff.join(', ')}`),
    ...user.profiles.filter((p) => p.action === 'conflict' || (p.diff && p.diff.length)).map((p) => `profile ${p.key}: ${p.diff.join(', ')}`),
    ...course.categories.filter((c) => c.action === 'conflict').map((c) => `category ${c.key}: ${c.diff.join(', ')}`),
    ...course.courses.filter((c) => c.action === 'conflict').map((c) => `course ${c.key}: ${c.diff.join(', ')}`),
    ...course.courses.filter((c) => c.lessons && c.lessons.conflict).map((c) => `course ${c.key}: ${c.lessons.conflict} lesson(s) differ`),
  ];
  const blocked = course.courses.filter((c) => c.action === 'blocked').map((c) => `course ${c.key}: waits for ${c.diff.join(', ')}`);
  const missingIndexes = [...auth.indexes, ...user.indexes, ...course.indexes].filter((i) => i.missing.length).map((i) => `${i.collection}: ${i.missing.join(', ')}${i.exists ? '' : ' (collection does not exist)'}`);
  return {
    accounts: tally(auth.accounts),
    profiles: tally(user.profiles),
    profileRows: sub,
    categories: tally(course.categories),
    courses: tally(course.courses),
    lessons,
    conflicts,
    blocked,
    missingIndexes,
    othersUnchanged: auth.others.unchanged && user.others.unchanged && course.others.unchanged,
    orphanLessons: course.orphanLessons,
  };
}

/**
 * Run DATA-01.
 *   apply=false (default): read-only plan.
 *   apply=true: refused when fixtures are invalid or a unique index is missing; otherwise creates what is missing.
 * Returns { mode, summary, consistency, plan, applied }. Throws StopError for a refused / failed run (nothing unsafe written).
 */
export async function runSeed({ apply = false, target = 'docker', env = process.env, fixturesDir, log = () => {} } = {}) {
  const fx = loadFixtures(fixturesDir);
  const problems = validateFixtures(fx);
  if (problems.length) throw new StopError(`fixtures are invalid:\n  - ${problems.join('\n  - ')}`);
  const inputs = buildPartInputs(fx);
  const opts = { target, env };

  let plan;
  try {
    plan = await planAll(fx, inputs, opts);
  } catch (e) {
    throw new StopError(`read-only check failed, nothing was written: ${e.message}`);
  }
  const planSummary = summarize(plan);
  if (!apply) {
    const consistency = checkConsistency(fx, plan.auth, plan.user, plan.course);
    return { mode: 'dry-run', summary: planSummary, consistency, plan };
  }

  if (planSummary.missingIndexes.length) {
    throw new StopError(`apply refused, unique indexes are missing (run the schema sync first, see docs/database-maintenance.md):\n  - ${planSummary.missingIndexes.join('\n  - ')}`);
  }

  // passwords for the accounts to create: stored locally BEFORE any account exists, never printed
  const toCreate = plan.auth.accounts.filter((a) => a.action === 'create').map((a) => ({ ...inputs.accounts.find((x) => x.key === a.key) }));
  let passwords;
  try {
    passwords = passwordsFor(toCreate, credentialsFile(env), { dataset: DATASET });
  } catch (e) {
    throw new StopError(e.message);
  }

  let auth;
  let user;
  let course;
  try {
    auth = await runPart('auth', {
      mode: 'apply',
      accounts: inputs.accounts.map(({ key, email, fullName }) => ({ key, email, fullName, ...(passwords.has(email) ? { password: passwords.get(email) } : {}) })),
    }, opts);
    log(`auth: ${JSON.stringify(tally(auth.accounts))}`);
    // a conflicting account gets no profile and owns no course
    const idOf = Object.fromEntries(auth.accounts.filter((a) => ['reuse', 'created'].includes(a.action)).map((a) => [a.key, a.id]));
    user = await runPart('user', {
      mode: 'apply',
      dataset: DATASET,
      accounts: inputs.accounts.filter((a) => idOf[a.key]).map((a) => ({ ...a, userId: idOf[a.key] })),
    }, opts);
    log(`user: ${JSON.stringify(tally(user.profiles))}`);
    const { instructors, adminId } = verifiedIds(fx, auth, user);
    course = await runPart('course', { mode: 'apply', adminId, instructors, categories: inputs.categories, courses: courseInputs(inputs, adminId) }, opts);
    log(`course: ${JSON.stringify(tally(course.courses))}`);
  } catch (e) {
    throw new StopError(`apply stopped: ${e.message} (re-running is safe: existing records are reused, never overwritten)`);
  }

  const after = await planAll(fx, inputs, opts);
  return {
    mode: 'apply',
    applied: { accounts: tally(auth.accounts), profiles: tally(user.profiles), categories: tally(course.categories), courses: tally(course.courses), othersUnchanged: auth.others.unchanged && user.others.unchanged && course.others.unchanged },
    // what this apply did (created / reuse / conflict / blocked); the consistency below is read again afterwards
    summary: summarize({ auth, user, course }),
    consistency: checkConsistency(fx, after.auth, after.user, after.course, { expectComplete: true }),
    plan: after,
  };
}

/** Read-only verification (verify-consistency.mjs). */
export async function runVerify({ target = 'docker', env = process.env, fixturesDir, expectComplete = false } = {}) {
  const fx = loadFixtures(fixturesDir);
  const inputs = buildPartInputs(fx);
  let plan;
  try {
    plan = await planAll(fx, inputs, { target, env });
  } catch (e) {
    throw new StopError(`verification could not read the databases: ${e.message}`);
  }
  return { summary: summarize(plan), consistency: checkConsistency(fx, plan.auth, plan.user, plan.course, { expectComplete }) };
}
