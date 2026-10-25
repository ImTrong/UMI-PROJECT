/**
 * FIX DEMO RANKING 02A: the admin leaderboard page reads the Learning Service contract as it is, and offers "finalize" only for a
 * past period whose stored status is known and not FINALIZED. Fixtures mirror the controllers' response bodies
 * (admin-leaderboard.controller.ts getOverview / manualFinalize, leaderboard.controller.ts getHistoryLeaderboard).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPeriod,
  comparePeriods,
  describeFinalizeError,
  describeFinalizeOutcome,
  describeStoredStatus,
  finalizeAvailability,
  LeaderboardContractError,
  parseOverview,
  parsePeriodLeaderboard,
  readApiError,
} from '../src/utils/leaderboard-period';

const entry = (over: Record<string, unknown> = {}) => ({
  userId: '665f1b2c3d4e5f6a7b8c9d01',
  rank: 1,
  points: 12.5,
  completedCourses: 2,
  averageScore: 88.5,
  lastCompletedAt: '2026-10-20T03:00:00.000Z',
  rewardPoints: 1000,
  rewardBadgeId: null,
  scoreBreakdown: [
    { courseId: 'c1', courseTitle: 'A', durationSeconds: 5400, durationHours: 1.5, level: 'BEGINNER', basePoints: 3, levelMultiplier: 1, achievementPoints: 3, averageQuizScore: null, hasQuiz: false, completedAt: '2026-10-19T03:00:00.000Z' },
  ],
  isTie: false,
  fullName: 'Nguyễn Văn A',
  avatar: null,
  ...over,
});

/** data of GET /admin/overview exactly as the controller builds it */
const overviewData = () => ({
  currentPeriod: { month: 10, year: 2026, status: 'ACTIVE', participantsCount: 14, topEntries: [entry(), entry({ userId: '665f1b2c3d4e5f6a7b8c9d02', rank: 2, rewardPoints: 700 })] },
  finalizedPeriods: [
    { id: 'p9', month: 9, year: 2026, status: 'FINALIZED', finalizedAt: '2026-10-01T00:05:10.000Z', finalizedBy: 'SYSTEM_CRON', participantsCount: 3, totalPointsAwarded: 2200 },
  ],
  stats: { totalValidCompletions: 41, totalRewardPointsBalance: 1700, totalRewardPointsAwarded: 2200 },
});

describe('periods', () => {
  test('current / past / future against the backend period, across a year boundary', () => {
    const cur = { month: 1, year: 2027 };
    assert.equal(classifyPeriod({ month: 1, year: 2027 }, cur), 'CURRENT');
    assert.equal(classifyPeriod({ month: 12, year: 2026 }, cur), 'PAST');
    assert.equal(classifyPeriod({ month: 2, year: 2027 }, cur), 'FUTURE');
    assert.equal(classifyPeriod({ month: 1, year: 2028 }, cur), 'FUTURE');
    assert.ok(comparePeriods({ month: 12, year: 2026 }, { month: 1, year: 2027 }) < 0);
  });

  test('finalize is offered only for a past period whose stored status is known and not FINALIZED', () => {
    assert.equal(finalizeAvailability('CURRENT', null).allowed, false);
    assert.equal(finalizeAvailability('CURRENT', 'ACTIVE').allowed, false, 'the running month is never offered, whatever the status');
    assert.equal(finalizeAvailability('FUTURE', 'ACTIVE').allowed, false);
    assert.equal(finalizeAvailability('PAST', null).allowed, false, 'unknown status: nothing offered');
    assert.equal(finalizeAvailability('PAST', 'FINALIZED').allowed, false);
    for (const s of ['ACTIVE', 'SNAPSHOT_BUILDING', 'SNAPSHOT_FROZEN', 'REWARDING']) {
      assert.equal(finalizeAvailability('PAST', s).allowed, true, s);
    }
    assert.match(finalizeAvailability('PAST', 'REWARDING').reason, /tiếp tục từ snapshot/);
    assert.match(finalizeAvailability('PAST', null).reason, /Chưa xác định/);
  });

  test('stored statuses have labels; an unknown one is shown as it is', () => {
    assert.equal(describeStoredStatus('FINALIZED'), 'Đã chốt');
    assert.equal(describeStoredStatus('FAILED'), 'Trạng thái khác: FAILED');
  });
});

describe('overview contract', () => {
  test('maps currentPeriod, finalizedPeriods and stats as the backend sends them', () => {
    const o = parseOverview(overviewData());
    assert.deepEqual([o.currentPeriod.month, o.currentPeriod.year, o.currentPeriod.participantsCount], [10, 2026, 14]);
    assert.equal(o.currentPeriod.topEntries.length, 2);
    assert.deepEqual(
      [o.currentPeriod.topEntries[1].rank, o.currentPeriod.topEntries[1].rewardPoints, o.currentPeriod.topEntries[0].fullName],
      [2, 700, 'Nguyễn Văn A']
    );
    assert.equal(o.currentPeriod.topEntries[0].averageScore, 88.5);
    assert.deepEqual(o.finalizedPeriods[0], {
      id: 'p9', month: 9, year: 2026, status: 'FINALIZED', finalizedAt: '2026-10-01T00:05:10.000Z', finalizedBy: 'SYSTEM_CRON', participantsCount: 3, totalPointsAwarded: 2200,
    });
    assert.deepEqual(o.stats, { totalValidCompletions: 41, totalRewardPointsBalance: 1700, totalRewardPointsAwarded: 2200 });
  });

  test('a missing statistic stays null (shown as a dash), it is not turned into 0', () => {
    const raw: any = overviewData();
    delete raw.stats.totalRewardPointsAwarded;
    raw.stats.totalValidCompletions = undefined;
    const o = parseOverview(raw);
    assert.equal(o.stats.totalRewardPointsAwarded, null);
    assert.equal(o.stats.totalValidCompletions, null);
    assert.equal(o.stats.totalRewardPointsBalance, 1700);
  });

  test('the old shape the page used to expect is rejected as a contract error instead of rendering an empty board', () => {
    const legacy = { activeLeaderboard: { entries: [] }, finalizedLeaderboard: null, totals: {}, policy: {} };
    assert.throws(() => parseOverview(legacy), LeaderboardContractError);
    assert.throws(() => parseOverview(undefined), LeaderboardContractError);
    const noCount: any = overviewData();
    delete noCount.currentPeriod.participantsCount;
    assert.throws(() => parseOverview(noCount), /participantsCount/);
    const badEntry: any = overviewData();
    badEntry.currentPeriod.topEntries[0].rank = '1';
    assert.throws(() => parseOverview(badEntry), LeaderboardContractError);
  });

  test('a finalized snapshot from the history API, and an entry the User Service could not name', () => {
    const p = parsePeriodLeaderboard({
      month: 9, year: 2026, status: 'FINALIZED', policyVersion: '1.1', totalParticipants: 3,
      entries: [entry({ fullName: undefined, rewardBadgeId: 'b1' })], finalizedAt: '2026-10-01T00:05:10.000Z', finalizedBy: 'SYSTEM_CRON',
    });
    assert.deepEqual([p.status, p.totalParticipants, p.finalizedBy], ['FINALIZED', 3, 'SYSTEM_CRON']);
    assert.equal(p.entries[0].fullName, null);
    assert.equal(p.entries[0].rewardBadgeId, 'b1');
    assert.throws(() => parsePeriodLeaderboard({ month: 9, year: 2026, entries: [] }), LeaderboardContractError, 'status is required');
  });
});

describe('finalize answers', () => {
  test('FINALIZED and ALREADY_FINALIZED are reported from the backend answer', () => {
    const done = describeFinalizeOutcome({
      message: 'Chốt sổ tháng 9/2026 thành công!',
      data: { status: 'FINALIZED', totalParticipants: 3, totalPointsAwarded: 2200, notificationsPending: 1, rewardsSkippedIneligible: 0 },
    });
    assert.equal(done.tone, 'success');
    assert.match(done.message, /^Chốt sổ tháng 9\/2026 thành công! \(3 học viên, 2200 điểm thưởng đã xác nhận, 1 thông báo chờ gửi lại\)$/);
    const again = describeFinalizeOutcome({
      message: 'Tháng 9/2026 đã được chốt trước đó. Dữ liệu lịch sử được giữ nguyên, không chốt lại.',
      data: { status: 'ALREADY_FINALIZED', totalParticipants: 3, totalPointsAwarded: 2200 },
    });
    assert.equal(again.tone, 'info');
    assert.match(again.message, /đã được chốt trước đó/);
    assert.equal(describeFinalizeOutcome({ message: '', data: { status: 'BUSY' } as any }).tone, 'error');
  });

  test('errors carry the backend message; incomplete rewards say that a retry is safe', () => {
    const busy = { response: { status: 409, data: { error: 'Tháng 9/2026 đang được xử lý bởi một tiến trình khác. Vui lòng thử lại sau.', message: 'Tháng 9/2026 đang được xử lý bởi một tiến trình khác. Vui lòng thử lại sau.', code: 'LEADERBOARD_BUSY' } } };
    assert.match(describeFinalizeError(busy).message, /đang được xử lý bởi một tiến trình khác/);
    const incomplete = { response: { status: 409, data: { error: 'x', message: 'x', details: { failures: [{}], verifiedPoints: 1000, expectedPoints: 1700 } } } };
    assert.match(describeFinalizeError(incomplete).message, /1000\/1700 điểm đã xác nhận.*chốt lại an toàn/);
    assert.equal(describeFinalizeError({ response: { status: 400, data: { error: 'Invalid month or year' } } }).message, 'Invalid month or year');
    assert.equal(describeFinalizeError({ response: { status: 500, data: {} } }).message, 'Không thể chốt bảng xếp hạng.');
    assert.match(describeFinalizeError({ request: {}, code: 'ERR_NETWORK' }).message, /Không kết nối được/);
  });

  test('readApiError: message first, then error, contract errors as they are', () => {
    assert.equal(readApiError({ response: { data: { error: 'Failed to get leaderboard overview' } } }, 'fb'), 'Failed to get leaderboard overview');
    assert.equal(readApiError({ response: { data: { error: 'e', message: 'm' } } }, 'fb'), 'm');
    assert.match(readApiError(new LeaderboardContractError('thiếu data'), 'fb'), /thiếu data/);
    assert.equal(readApiError(new Error('boom'), 'fb'), 'fb');
  });
});
