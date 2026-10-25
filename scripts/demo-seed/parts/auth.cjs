/* eslint-disable */
// Runs INSIDE elearning-auth-service (`docker exec -i ... node -`), with INPUT prepended by seed-ranking-demo.mjs.
// Creates (or reuses, by unique email) the demo login accounts the same way AuthService.register stores them: bcryptjs hash with
// BCRYPT_ROUNDS (default 10). emailVerified/isActive are set like the seeded default accounts, so the demo can log in at once.
// No verification e-mail, no session, no token is created. A password is only received for an account that does not exist yet,
// and it is never printed. mode 'plan' = read-only; mode 'apply' = create the missing accounts. An existing account is NEVER changed.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
const out = (o) => console.log('RESULT:' + JSON.stringify(o));

(async () => {
  const { mode, accounts, verify = [] } = INPUT;
  const result = [];
  for (const a of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: a.email } });
    if (existing) {
      result.push({ key: a.key, email: a.email, id: existing.id, action: 'reuse', isActive: existing.isActive, fullName: existing.fullName });
      continue;
    }
    if (mode !== 'apply') { result.push({ key: a.key, email: a.email, id: null, action: 'create' }); continue; }
    if (!a.password || a.password.length < 12) throw new Error(`no usable password supplied for new account ${a.key}`);
    const hash = await bcrypt.hash(a.password, parseInt(process.env.BCRYPT_ROUNDS || '10', 10));
    const user = await prisma.user.create({ data: { email: a.email, password: hash, fullName: a.fullName, emailVerified: true, isActive: true } });
    result.push({ key: a.key, email: a.email, id: user.id, action: 'created', isActive: user.isActive, fullName: user.fullName });
  }
  // read-only: does the stored hash accept the password kept in the local credentials file? (no session, no token)
  const checks = [];
  for (const v of verify) {
    const u = await prisma.user.findUnique({ where: { email: v.email } });
    checks.push({ key: v.key, passwordMatches: !!u && (await bcrypt.compare(v.password, u.password)) });
  }
  // digest of the accounts that are NOT demo accounts (stable fields only: a login updates lastLogin/updatedAt)
  const others = await prisma.user.findMany({
    where: { email: { notIn: accounts.map((a) => a.email) } },
    orderBy: { id: 'asc' },
    select: { id: true, email: true, password: true, fullName: true, emailVerified: true, isActive: true, createdAt: true },
  });
  const digest = require('crypto').createHash('sha256').update(JSON.stringify(others)).digest('hex');
  out({ accounts: result, checks, users: await prisma.user.count(), othersDigest: digest });
  await prisma.$disconnect();
})().catch(async (e) => { out({ error: e.message }); await prisma.$disconnect().catch(() => {}); process.exit(1); });
