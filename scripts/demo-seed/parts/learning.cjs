/* eslint-disable */
// Runs INSIDE elearning-learning-service (`docker exec -i ... node -`), with INPUT prepended by seed-ranking-demo.mjs.
// Uses the container's own Prisma client and DATABASE_URL (no credential leaves the container) and the service's own code:
//   - CourseClientService.getCourseMetadata + calculateCourseAchievementPoints for the expected points (read-only HTTP to course-service)
//   - AchievementService.recordCourseCompletion to create each completion record (idempotent on [userId, courseId])
//   - the ensureWallet logic of course-redemption.service (find, else create an empty wallet; a raced create is re-read)
// mode 'probe'  : read-only - periods, counts, digests of existing data, course metadata, existing demo records
// mode 'apply'  : writes ONLY completion records / empty wallets of the demo user ids given in INPUT
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();
const logger = require('./dist/utils/logger').default;
logger.transports.forEach((t) => { t.silent = true; });
const { CourseClientService } = require('./dist/services/course-client.service');
const policy = require('./dist/config/scoring-policy');

const out = (o) => console.log('RESULT:' + JSON.stringify(o));
const digest = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');

async function snapshot(excludeUserIds) {
  const notDemo = excludeUserIds.length ? { userId: { notIn: excludeUserIds } } : {};
  const records = await prisma.courseCompletionRecord.findMany({ where: notDemo, orderBy: { id: 'asc' } });
  const wallets = await prisma.userRewardPoint.findMany({ where: notDemo, orderBy: { id: 'asc' } });
  const ledger = await prisma.rewardPointTransaction.findMany({ orderBy: { id: 'asc' } });
  const boards = await prisma.monthlyLeaderboard.findMany({ orderBy: { id: 'asc' } });
  const entries = await prisma.leaderboardEntry.findMany({ orderBy: { id: 'asc' } });
  const audit = await prisma.leaderboardAuditLog.findMany({ orderBy: { id: 'asc' } });
  return {
    counts: {
      records: await prisma.courseCompletionRecord.count(), wallets: await prisma.userRewardPoint.count(), ledger: ledger.length,
      boards: boards.length, entries: entries.length, audit: audit.length, badges: await prisma.badge.count(), redemptions: await prisma.courseRedemption.count(),
    },
    // digests of everything that is NOT demo data: must be identical before and after the seed
    digests: { records: digest(records), wallets: digest(wallets), ledger: digest(ledger), boards: digest(boards), entries: digest(entries), audit: digest(audit) },
  };
}

async function periodInfo(month, year) {
  const board = await prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month, year } } });
  const entries = board ? await prisma.leaderboardEntry.count({ where: { leaderboardId: board.id } }) : 0;
  const recs = await prisma.courseCompletionRecord.groupBy({ by: ['status'], where: { month, year }, _count: true });
  return {
    month, year,
    state: policy.getVietnamPeriodState(month, year).state,
    board: board ? { status: board.status, totalParticipants: board.totalParticipants } : null,
    entries,
    records: Object.fromEntries(recs.map((r) => [r.status, r._count])),
  };
}

async function ensureWallet(userId) {
  const existing = await prisma.userRewardPoint.findUnique({ where: { userId } });
  if (existing) return { created: false, wallet: existing };
  try {
    return { created: true, wallet: await prisma.userRewardPoint.create({ data: { userId, balance: 0, totalEarned: 0, totalSpent: 0 } }) };
  } catch (e) {
    if (e && e.code === 'P2002') return { created: false, wallet: await prisma.userRewardPoint.findUnique({ where: { userId } }) };
    throw e;
  }
}

(async () => {
  const { mode, demoUserIds = [], periods = [], courseIds = [], completions = [] } = INPUT;
  if (mode === 'probe') {
    const metadata = {};
    for (const id of courseIds) {
      const m = await CourseClientService.getCourseMetadata(id);
      const calc = policy.calculateCourseAchievementPoints(m.totalDurationSeconds, m.level, m.approvalStatus === 'APPROVED');
      metadata[id] = { title: m.title, level: m.level, approvalStatus: m.approvalStatus, seconds: m.totalDurationSeconds, valid: m.totalDurationSeconds > 0, points: m.totalDurationSeconds > 0 ? calc.achievementPoints : 0 };
    }
    const existingDemo = demoUserIds.length
      ? await prisma.courseCompletionRecord.findMany({ where: { userId: { in: demoUserIds } }, select: { userId: true, courseId: true, month: true, year: true, status: true, achievementPoints: true } })
      : [];
    const demoWallets = demoUserIds.length ? await prisma.userRewardPoint.findMany({ where: { userId: { in: demoUserIds } }, select: { userId: true, balance: true } }) : [];
    out({
      now: policy.getCurrentVietnamMonthYear(),
      periods: await Promise.all(periods.map((p) => periodInfo(p.month, p.year))),
      metadata,
      existingDemo,
      demoWallets,
      snapshot: await snapshot(demoUserIds),
    });
  } else if (mode === 'apply') {
    const allowed = new Set(demoUserIds);
    const { AchievementService } = require('./dist/services/achievement.service');
    const results = [];
    for (const c of completions) {
      if (!allowed.has(c.userId)) throw new Error('refusing to write for a user id that is not a demo id');
      const before = await prisma.courseCompletionRecord.findUnique({ where: { userId_courseId: { userId: c.userId, courseId: c.courseId } } });
      const rec = await AchievementService.recordCourseCompletion(c.userId, c.courseId, new Date(c.completedAt), c.title, null);
      results.push({ userId: c.userId, courseId: c.courseId, created: !before, status: rec.status, month: rec.month, year: rec.year, points: rec.achievementPoints });
    }
    const wallets = [];
    for (const id of demoUserIds) {
      const w = await ensureWallet(id);
      wallets.push({ userId: id, created: w.created, balance: w.wallet.balance });
    }
    out({ results, wallets });
  } else {
    throw new Error('unknown mode');
  }
  await prisma.$disconnect();
})().catch(async (e) => { out({ error: e.message }); await prisma.$disconnect().catch(() => {}); process.exit(1); });
