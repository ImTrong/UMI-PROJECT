/**
 * FIX 06C-4B2B2 end to end: the REAL Learning Service sender (LeaderboardService.retryFailedNotifications -> sendRewardNotification ->
 * UserNotificationClient, real axios) against the REAL User Service (its app, controllers, idempotent NotificationService, Prisma client
 * and Socket.IO gateway, started in a child process by tests/helpers/user-service-process.js), each on its own ISOLATED database of the
 * replica set named by TEST_DATABASE_URL (`<name>_kne2e` for learning, `<name>_kne2eusers` for users; both dropped at the end).
 * Nothing leaves 127.0.0.1; no Docker container, no shared database, no real learner.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 *
 * KN-01 / KN-02 / KN-03: the same reward event sent again (a retry after an unknown outcome, a crash before the outcome was recorded) uses
 *         the same key; the User Service keeps ONE notification, answers 200 deduplicated, does not push again; the sender records success.
 * KN-05: a key the User Service already holds for a DIFFERENT notification -> 422, recorded as an error, the stored one is untouched;
 *         no token -> no request at all.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, fork, ChildProcess } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { resolveTestDb } from '../helpers/test-db-url';

const learningDb = resolveTestDb('kne2e');
const usersDb = resolveTestDb('kne2eusers');
const MONTH = 9;
const YEAR = 2026;
const oid = () => randomBytes(12).toString('hex');
const derivedId = (key: string) => createHash('sha256').update(`umi:notification-idempotency:v1:${key}`).digest().subarray(0, 12).toString('hex');
const keyOf = (u: string) => `reward_lb_notify_${MONTH}_${YEAR}_${u}`;

describe('END TO END: learning sender -> real User Service, idempotent reward notification (FIX 06C-4B2B2)', { skip: learningDb.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let learning: any;
  let users: any;
  let child: ChildProcess;
  let LeaderboardService: any;
  const pushes: Array<{ userId: string; id: string }> = [];
  let boardId = '';
  const token = randomBytes(24).toString('hex');

  const seedRewardedEntry = async (userId: string, rank: number, rewardPoints: number, badgeName: string, icon: string) => {
    const badge = await learning.badge.create({
      data: { userId, badgeName, badgeType: 'LEADERBOARD_REWARD', description: 'd', iconUrl: icon, metadata: { month: MONTH, year: YEAR, rank, rewardPoints } },
    });
    // a FINALIZED snapshot entry whose first notification attempt failed (the marker the production retry looks for)
    await learning.leaderboardEntry.create({
      data: { leaderboardId: boardId, userId, rank, points: 60 - rank * 10, completedCourses: 1, lastCompletedAt: new Date('2026-09-20T00:00:00Z'), rewardPoints, rewardBadgeId: badge.id, isTie: false, rewardNotifyError: 'timeout of 5000ms exceeded' },
    });
  };
  const entryOf = async (userId: string) => learning.leaderboardEntry.findFirst({ where: { leaderboardId: boardId, userId } });
  const markUndelivered = (userId: string) =>
    learning.$runCommandRaw({ update: 'leaderboard_entries', updates: [{ q: { userId: { $oid: userId } }, u: { $set: { rewardNotifyError: 'process died before the outcome was recorded' }, $unset: { rewardNotifiedAt: '' } } }] });

  before(async () => {
    for (const t of [learningDb, usersDb]) assert.match(t.url as string, /127\.0\.0\.1:\d+\/[^/?]*test/i, 'isolated local test databases only');
    process.env.DATABASE_URL = learningDb.url;
    process.env.INTERNAL_SERVICE_TOKEN = token;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: learningDb.url }, stdio: 'pipe' });
    const { PrismaClient } = require('@prisma/client');
    learning = new PrismaClient({ datasources: { db: { url: learningDb.url } } });
    // the user database is read with a plain driver-level client of the learning schema (raw commands only)
    users = new PrismaClient({ datasources: { db: { url: usersDb.url } } });
    await users.$runCommandRaw({ dropDatabase: 1 });
    for (const m of ['leaderboardEntry', 'monthlyLeaderboard', 'badge']) await learning[m].deleteMany({});

    child = fork(path.join(__dirname, '..', 'helpers', 'user-service-process.js'), [], {
      cwd: os.tmpdir(),
      execArgv: [], // not this process's ts-node: the child registers the user-service's own
      env: { ...process.env, DATABASE_URL: usersDb.url, INTERNAL_SERVICE_TOKEN: token, JWT_SECRET: randomBytes(16).toString('hex'), NODE_ENV: 'test' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('user-service did not start within 60 s')), 60_000);
      child.on('message', (m: any) => {
        if (m?.type === 'ready') { clearTimeout(timer); resolve(m.port); }
        if (m?.type === 'push') pushes.push({ userId: m.userId, id: m.id });
      });
      let stderr = '';
      child.stderr?.on('data', (d) => { stderr += d; });
      child.on('exit', (code) => reject(new Error(`user-service exited (${code}): ${stderr.slice(-600)}`)));
    });
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${port}`;

    require('../../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    ({ LeaderboardService } = require('../../src/services/leaderboard.service'));
    const board = await learning.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status: 'FINALIZED', finalizedAt: new Date(), totalParticipants: 2, totalPointsAwarded: 1700, finalizedBy: 'e2e', policyVersion: '1.1' } });
    boardId = board.id;
  });

  after(async () => {
    try { child?.kill(); } catch { /* gone */ }
    try { await learning?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    try { await users?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await learning?.$disconnect();
    await users?.$disconnect();
  });

  const storedFor = async (userId: string) =>
    (await users.$runCommandRaw({ find: 'notifications', filter: { userId: { $oid: userId } } })).cursor.firstBatch;

  it('KN-01 / KN-02 / KN-03: the event is sent again after an unknown outcome or a crash before recording - same key, ONE notification, ONE push, recorded as delivered', async () => {
    const u = oid();
    await seedRewardedEntry(u, 1, 1000, 'Nhà vô địch tháng 09/2026', '🥇');

    // first attempt of the production retry: created
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    let stored = await storedFor(u);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]._id.$oid, derivedId(keyOf(u)), 'the _id in the user database is derived from the key the learning service sent');
    assert.equal(stored[0].idempotencyKey, keyOf(u));
    assert.equal(stored[0].title, '🏆 Chúc mừng! Bạn đạt Nhà vô địch tháng 09/2026');
    assert.equal(stored[0].message, 'Bạn đạt thứ hạng #1 trong Bảng xếp hạng tháng 09/2026 với 50 điểm thành tích và nhận được 1000 điểm thưởng cùng huy hiệu 🥇!');
    assert.ok((await entryOf(u)).rewardNotifiedAt);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(pushes.filter((p) => p.userId === u).length, 1);

    // the learning process "died" after the User Service stored it but before the outcome was recorded: the marker says undelivered
    for (let attempt = 0; attempt < 3; attempt++) {
      await markUndelivered(u);
      assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0, 'the 200 deduplicated answer counts as delivered');
      const e = await entryOf(u);
      assert.ok(e.rewardNotifiedAt);
      assert.equal(e.rewardNotifyError, null);
      assert.equal(e.rewardNotifyClaimToken, null);
    }
    stored = await storedFor(u);
    assert.equal(stored.length, 1, 'still ONE notification after 4 requests');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(pushes.filter((p) => p.userId === u).length, 1, 'and still ONE push');
  });

  it('KN-05: the User Service already holds the key for a DIFFERENT notification -> 422 recorded as an error, the stored one untouched, no push; a retry keeps the same key', async () => {
    const u = oid();
    await seedRewardedEntry(u, 2, 700, 'Á quân tháng 09/2026', '🥈');
    await users.$runCommandRaw({ insert: 'notifications', documents: [{ _id: { $oid: derivedId(keyOf(u)) }, userId: { $oid: u }, title: 'x', message: 'y', type: 'INFO', isRead: false, link: '/elsewhere', idempotencyKey: keyOf(u), createdAt: { $date: new Date().toISOString() } }] });
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1);
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1);
    const e = await entryOf(u);
    assert.match(e.rewardNotifyError, /status code 422/);
    assert.ok(!e.rewardNotifiedAt);
    const stored = await storedFor(u);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].link, '/elsewhere', 'the stored notification was not changed');
    assert.equal(pushes.filter((p) => p.userId === u).length, 0);
  });

  it('KN-05: without INTERNAL_SERVICE_TOKEN the learning side sends nothing; with a wrong one the User Service refuses (403) and stores nothing', async () => {
    const u = oid();
    await seedRewardedEntry(u, 3, 500, 'Top 3 tháng 09/2026', '🥉');
    const saved = process.env.INTERNAL_SERVICE_TOKEN;
    try {
      delete process.env.INTERNAL_SERVICE_TOKEN;
      await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
      assert.match((await entryOf(u)).rewardNotifyError, /INTERNAL_SERVICE_TOKEN is not configured/);
      process.env.INTERNAL_SERVICE_TOKEN = 'not-the-shared-secret';
      await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
      assert.match((await entryOf(u)).rewardNotifyError, /403/);
    } finally {
      process.env.INTERNAL_SERVICE_TOKEN = saved;
    }
    assert.equal((await storedFor(u)).length, 0);
    // the right secret again: delivered once
    await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal((await storedFor(u)).length, 1);
    assert.ok((await entryOf(u)).rewardNotifiedAt);
  });
});
