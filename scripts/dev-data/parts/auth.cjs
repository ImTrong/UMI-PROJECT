/* eslint-disable */
// DATA-01 part for auth_db. Runs with the auth-service's own Prisma client (`docker exec -i elearning-auth-service node -`, or
// `node -` in services/auth-service against an isolated DB), with `const INPUT = {...};` prepended by lib/runner.mjs.
//   mode 'plan'  : read-only. Per fixture account: create | reuse | conflict, plus the unique-index state.
//   mode 'apply' : creates the missing accounts the way AuthService.register stores them (bcryptjs, BCRYPT_ROUNDS, default 10),
//                  emailVerified/isActive true like the seeded accounts. Refused when users.email has no unique index.
// An existing account is NEVER changed (no update/upsert/delete in this file). Only @umi-demo.local addresses are handled.
// Passwords arrive only for accounts to create and are never printed; hashes are never returned.
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();
const out = (o) => console.log('RESULT:' + JSON.stringify(o));
const DEV_DOMAIN = /@umi-demo\.local$/;

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

async function othersDigest(emails) {
  const others = await prisma.user.findMany({
    where: { email: { notIn: emails } },
    orderBy: { id: 'asc' },
    select: { id: true, email: true, password: true, fullName: true, emailVerified: true, isActive: true, createdAt: true },
  });
  return { count: others.length, sha256: crypto.createHash('sha256').update(JSON.stringify(others)).digest('hex') };
}

function compare(row, a) {
  const diff = [];
  if (row.fullName !== a.fullName) diff.push('fullName');
  if (row.isActive !== true) diff.push('isActive');
  if (row.emailVerified !== true) diff.push('emailVerified');
  return diff;
}

(async () => {
  const { mode, accounts } = INPUT;
  if (mode !== 'plan' && mode !== 'apply') throw new Error(`unknown mode ${mode}`);
  for (const a of accounts) if (!DEV_DOMAIN.test(a.email)) throw new Error(`refusing a non-development e-mail for ${a.key}`);

  const indexes = [await uniqueIndexState('users', [['email']])];
  if (mode === 'apply' && indexes.some((i) => i.missing.length > 0)) {
    throw new Error('auth_db.users has no unique index on email - run the schema sync (prisma db push) first; nothing was written');
  }
  const emails = accounts.map((a) => a.email);
  const before = await othersDigest(emails);
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
  const result = [];

  for (const a of accounts) {
    const rows = await prisma.user.findMany({ where: { email: a.email }, select: { id: true, fullName: true, emailVerified: true, isActive: true } });
    if (rows.length > 1) { result.push({ key: a.key, id: null, action: 'conflict', diff: ['duplicate-email'] }); continue; }
    if (rows.length === 1) {
      const diff = compare(rows[0], a);
      result.push({ key: a.key, id: rows[0].id, action: diff.length ? 'conflict' : 'reuse', diff, isActive: rows[0].isActive });
      continue;
    }
    if (mode !== 'apply') { result.push({ key: a.key, id: null, action: 'create' }); continue; }
    if (typeof a.password !== 'string' || a.password.length < 16) throw new Error(`no usable password supplied for new account ${a.key}`);
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(a.password, rounds);
    try {
      const u = await prisma.user.create({ data: { email: a.email, password: hash, fullName: a.fullName, emailVerified: true, isActive: true } });
      result.push({ key: a.key, id: u.id, action: 'created', diff: [], isActive: u.isActive });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
      // created concurrently by another run: read it back, never overwrite
      const row = await prisma.user.findUnique({ where: { email: a.email }, select: { id: true, fullName: true, emailVerified: true, isActive: true } });
      const diff = row ? compare(row, a) : ['vanished'];
      result.push({ key: a.key, id: row ? row.id : null, action: diff.length ? 'conflict' : 'reuse', diff });
    }
  }

  const after = await othersDigest(emails);
  out({ accounts: result, indexes, others: { before, after, unchanged: before.sha256 === after.sha256 }, total: await prisma.user.count() });
  await prisma.$disconnect();
})().catch(async (e) => {
  out({ error: String(e.message || e).replace(/mongodb(\+srv)?:\/\/\S+/g, 'mongodb://***').slice(0, 500) });
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
