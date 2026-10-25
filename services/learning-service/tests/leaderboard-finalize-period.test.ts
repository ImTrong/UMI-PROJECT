/**
 * FIX DEMO RANKING 02C.2: an administrator may finalize only a period that has ENDED in Asia/Ho_Chi_Minh.
 *
 * The rule is checked at the admin API boundary (AdminLeaderboardController.manualFinalize) before anything is read or written;
 * LeaderboardService.finalizeMonth itself - used by the startup catch-up, the monthly cron and the reconciliation pass with past
 * months only - is not changed. The controller runs against the in-memory Prisma fake; the clock is node:test's mocked Date.
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePrisma, db } from './helpers/fake-prisma';

installFakePrisma();

/* eslint-disable @typescript-eslint/no-var-requires */
const logger = require('../src/utils/logger').default;
const { getVietnamPeriodState, getCurrentVietnamMonthYear } = require('../src/config/scoring-policy');
const { LeaderboardService } = require('../src/services/leaderboard.service');
const { AdminLeaderboardController } = require('../src/controllers/admin-leaderboard.controller');

logger.transports.forEach((t: any) => { t.silent = true; });

const ADMIN = '64b000000000000000000001';

describe('getVietnamPeriodState (Asia/Ho_Chi_Minh, UTC+7)', () => {
  const at = (iso: string) => new Date(iso);

  it('previous / current / next month in the middle of a month', () => {
    const now = at('2026-10-15T05:00:00Z');
    assert.equal(getVietnamPeriodState(9, 2026, now).state, 'ENDED');
    assert.equal(getVietnamPeriodState(10, 2026, now).state, 'CURRENT');
    assert.equal(getVietnamPeriodState(11, 2026, now).state, 'FUTURE');
    assert.equal(getVietnamPeriodState(3, 2025, now).state, 'ENDED');
    assert.equal(getVietnamPeriodState(1, 2027, now).state, 'FUTURE');
    assert.deepEqual(getVietnamPeriodState(9, 2026, now).current, { month: 10, year: 2026 });
  });

  it('last millisecond of a month and first millisecond of the next one, in Vietnam time', () => {
    const lastMs = at('2026-10-31T16:59:59.999Z'); // 31/10 23:59:59.999 in Vietnam (UTC still 31/10)
    assert.equal(getVietnamPeriodState(10, 2026, lastMs).state, 'CURRENT');
    assert.equal(getVietnamPeriodState(11, 2026, lastMs).state, 'FUTURE');
    const firstMs = at('2026-10-31T17:00:00.000Z'); // 01/11 00:00:00.000 in Vietnam while UTC is still 31/10
    assert.equal(getVietnamPeriodState(10, 2026, firstMs).state, 'ENDED');
    assert.equal(getVietnamPeriodState(11, 2026, firstMs).state, 'CURRENT');
  });

  it('start of a month: UTC is still in the previous month', () => {
    const vnStart = at('2026-09-30T17:00:00.000Z'); // 01/10 00:00 in Vietnam
    assert.equal(getVietnamPeriodState(10, 2026, vnStart).state, 'CURRENT');
    assert.equal(getVietnamPeriodState(9, 2026, vnStart).state, 'ENDED');
    const justBefore = at('2026-09-30T16:59:59.999Z'); // 30/09 23:59:59.999 in Vietnam
    assert.equal(getVietnamPeriodState(9, 2026, justBefore).state, 'CURRENT');
    assert.equal(getVietnamPeriodState(10, 2026, justBefore).state, 'FUTURE');
  });

  it('year boundary', () => {
    const newYear = at('2026-12-31T17:00:00.000Z'); // 01/01/2027 00:00 in Vietnam
    assert.equal(getVietnamPeriodState(12, 2026, newYear).state, 'ENDED');
    assert.equal(getVietnamPeriodState(1, 2027, newYear).state, 'CURRENT');
    const lastOfYear = at('2026-12-31T16:59:59.999Z');
    assert.equal(getVietnamPeriodState(12, 2026, lastOfYear).state, 'CURRENT');
    assert.equal(getVietnamPeriodState(1, 2027, lastOfYear).state, 'FUTURE');
  });
});

describe('POST admin/leaderboard/finalize: only an ended period', () => {
  let finalizeCalls: any[];

  const call = async (body: any) => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.body = b; return this; },
    };
    await AdminLeaderboardController.manualFinalize({ user: { userId: ADMIN, email: 'admin@umi.vn' }, body }, res);
    return res;
  };

  beforeEach(() => {
    db.reset();
    finalizeCalls = [];
    // 15/10/2026 12:00 in Vietnam
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T05:00:00Z') });
    mock.method(LeaderboardService, 'finalizeMonth', async (...args: any[]) => {
      finalizeCalls.push(args);
      return { status: 'ALREADY_FINALIZED', totalParticipants: 0, totalPointsAwarded: 0 };
    });
  });
  afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

  it('the clock really is mocked (guards the tests below)', () => {
    assert.deepEqual(getCurrentVietnamMonthYear(), { month: 10, year: 2026 });
  });

  it('the previous month is passed to the service and audited', async () => {
    const res = await call({ month: 9, year: 2026, reason: 'demo' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(finalizeCalls, [[9, 2026, 'ADMIN:admin@umi.vn']]);
    assert.equal(db.tables.leaderboardAuditLog.filter((a: any) => a.action === 'MANUAL_FINALIZE').length, 1);
  });

  it('digit strings are accepted (the admin page and older clients send either)', async () => {
    const res = await call({ month: '09', year: '2026' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(finalizeCalls, [[9, 2026, 'ADMIN:admin@umi.vn']]);
  });

  it('the current month is refused with a structured error; nothing is called or written', async () => {
    const res = await call({ month: 10, year: 2026 });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'LEADERBOARD_PERIOD_NOT_ENDED');
    assert.match(res.body.message, /đang diễn ra/);
    assert.equal(res.body.error, res.body.message);
    assert.deepEqual(res.body.details, { month: 10, year: 2026, state: 'CURRENT', currentMonth: 10, currentYear: 2026, timeZone: 'Asia/Ho_Chi_Minh' });
    assert.equal(finalizeCalls.length, 0);
    assert.equal(db.tables.leaderboardAuditLog.length, 0);
    assert.equal(db.tables.monthlyLeaderboard.length, 0);
  });

  it('future months are refused (next month, next year)', async () => {
    for (const body of [{ month: 11, year: 2026 }, { month: 1, year: 2027 }, { month: '12', year: '2026' }]) {
      const res = await call(body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'LEADERBOARD_PERIOD_NOT_ENDED');
      assert.equal(res.body.details.state, 'FUTURE');
      assert.match(res.body.message, /chưa bắt đầu/);
    }
    assert.equal(finalizeCalls.length, 0);
    assert.equal(db.tables.leaderboardAuditLog.length, 0);
  });

  it('Vietnam month boundary: 31/10 23:59:59.999 refuses October, 01/11 00:00 accepts it', async () => {
    mock.timers.setTime(new Date('2026-10-31T16:59:59.999Z').getTime());
    assert.equal((await call({ month: 10, year: 2026 })).statusCode, 400);
    mock.timers.setTime(new Date('2026-10-31T17:00:00.000Z').getTime());
    const res = await call({ month: 10, year: 2026 });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(finalizeCalls, [[10, 2026, 'ADMIN:admin@umi.vn']]);
    assert.equal((await call({ month: 11, year: 2026 })).body.details.state, 'CURRENT');
  });

  it('invalid parameters are 400 "Invalid month or year" before the period rule', async () => {
    const bad = [
      {}, { month: 9 }, { year: 2026 }, { month: 0, year: 2026 }, { month: 13, year: 2026 }, { month: -1, year: 2026 },
      { month: 9.5, year: 2026 }, { month: '9abc', year: 2026 }, { month: '', year: 2026 }, { month: null, year: 2026 },
      { month: 9, year: 'abc' }, { month: 9, year: 1999 }, { month: 9, year: 2101 }, { month: [9], year: 2026 },
    ];
    for (const body of bad) {
      const res = await call(body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.error, 'Invalid month or year', JSON.stringify(body));
    }
    assert.equal(finalizeCalls.length, 0);
    assert.equal(db.tables.leaderboardAuditLog.length, 0);
  });

  it('the period rule is not applied to the service: catch-up still finalizes the past months it selects', async () => {
    mock.restoreAll();
    const seen: Array<[number, number]> = [];
    mock.method(LeaderboardService, 'finalizeMonth', async (m: number, y: number) => {
      seen.push([m, y]);
      return { status: 'FINALIZED', totalParticipants: 0, totalPointsAwarded: 0 };
    });
    const res = await LeaderboardService.checkAndFinalizeAllPastMonths({ initiator: 'TEST' });
    assert.deepEqual(seen, [[4, 2026], [5, 2026], [6, 2026], [7, 2026], [8, 2026], [9, 2026]]);
    assert.deepEqual(res.finalizedMonths, ['4/2026', '5/2026', '6/2026', '7/2026', '8/2026', '9/2026']);
  });
});
