/**
 * FIX DEMO RANKING 02A: the service calls the existing Learning Service routes with the parameters they read, and hands the page
 * parsed data. HTTP is answered by an axios adapter (no network).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { learningApi } from '../src/services/api';
import { adminLeaderboardService } from '../src/services/admin-leaderboard.service';
import { LeaderboardContractError } from '../src/utils/leaderboard-period';
import { isOutcomeUnknown } from '../src/utils/leaderboard-admin';
import { RECORD, USER, auditData, studentData, syncData, transactionsData } from './fixtures/admin-leaderboard';

(globalThis as any).localStorage ??= { getItem: () => null, removeItem: () => {} };

let calls: Array<{ method: string; url: string; params: any; body: any }> = [];
let answer: { status: number; data: any } = { status: 200, data: {} };

beforeEach(() => {
  calls = [];
  learningApi.defaults.adapter = async (config: any) => {
    calls.push({ method: config.method, url: config.url, params: config.params, body: config.data ? JSON.parse(config.data) : undefined });
    const response = { data: answer.data, status: answer.status, statusText: String(answer.status), headers: {}, config };
    if (answer.status >= 400) {
      const err: any = new Error(`Request failed with status code ${answer.status}`);
      err.response = response;
      err.config = config;
      throw err;
    }
    return response;
  };
});

test('getOverview: the admin overview route, no month/year (the backend reads none), parsed data', async () => {
  answer = {
    status: 200,
    data: { data: { currentPeriod: { month: 10, year: 2026, status: 'ACTIVE', participantsCount: 0, topEntries: [] }, finalizedPeriods: [], stats: { totalValidCompletions: 0, totalRewardPointsBalance: 0, totalRewardPointsAwarded: 0 } } },
  };
  const o = await adminLeaderboardService.getOverview();
  assert.deepEqual(calls, [{ method: 'get', url: '/api/learning/leaderboard/admin/overview', params: undefined, body: undefined }]);
  assert.deepEqual([o.currentPeriod.month, o.currentPeriod.participantsCount, o.finalizedPeriods.length], [10, 0, 0]);
  assert.equal(o.stats.totalValidCompletions, 0, 'a real 0 from the API stays 0');
});

test('getOverview: an answer in another shape is a contract error, not an empty overview', async () => {
  answer = { status: 200, data: { data: { activeLeaderboard: null, finalizedLeaderboard: null, totals: {} } } };
  await assert.rejects(adminLeaderboardService.getOverview(), LeaderboardContractError);
});

test('getPeriodLeaderboard: the history route with month and year', async () => {
  answer = { status: 200, data: { data: { month: 9, year: 2026, status: 'REWARDING', totalParticipants: 2, entries: [], finalizedAt: null, finalizedBy: null } } };
  const p = await adminLeaderboardService.getPeriodLeaderboard(9, 2026);
  assert.deepEqual(calls, [{ method: 'get', url: '/api/learning/leaderboard/history', params: { month: 9, year: 2026 }, body: undefined }]);
  assert.deepEqual([p.status, p.totalParticipants], ['REWARDING', 2]);
});

test('finalizeMonth: posts month, year and reason once and returns the message with the result', async () => {
  answer = { status: 200, data: { message: 'Chốt sổ tháng 9/2026 thành công!', data: { status: 'FINALIZED', totalParticipants: 2, totalPointsAwarded: 1700 } } };
  const res = await adminLeaderboardService.finalizeMonth({ month: 9, year: 2026, reason: 'demo' });
  assert.deepEqual(calls, [{ method: 'post', url: '/api/learning/leaderboard/admin/finalize', params: undefined, body: { month: 9, year: 2026, reason: 'demo' } }]);
  assert.deepEqual(res, { message: 'Chốt sổ tháng 9/2026 thành công!', data: { status: 'FINALIZED', totalParticipants: 2, totalPointsAwarded: 1700 } });
});

// ─── FIX DEMO RANKING 02B: admin actions ───────────────────────────────────────────────────────────────────────────────

test('syncCompletions: POST without body, parsed counts', async () => {
  answer = { status: 200, data: { message: 'Đồng bộ dữ liệu hoàn tất!', data: syncData() } };
  const r = await adminLeaderboardService.syncCompletions();
  assert.deepEqual(calls, [{ method: 'post', url: '/api/learning/leaderboard/admin/sync-completions', params: undefined, body: undefined }]);
  assert.deepEqual([r.created, r.skipped, r.needsReview], [3, 1, 2]);
});

test('syncCompletions: 500 is passed on, an answer without the counts is a contract error', async () => {
  answer = { status: 500, data: { error: 'Failed to sync completions' } };
  await assert.rejects(adminLeaderboardService.syncCompletions(), (err: any) => err.response.status === 500);
  answer = { status: 200, data: { message: 'ok', data: { syncedCount: 1 } } };
  await assert.rejects(adminLeaderboardService.syncCompletions(), LeaderboardContractError);
});

test('getStudentDetail: user id in the path, month/year as query, parsed detail', async () => {
  answer = { status: 200, data: { data: studentData() } };
  const d = await adminLeaderboardService.getStudentDetail(USER, 10, 2026);
  assert.deepEqual(calls, [{ method: 'get', url: `/api/learning/leaderboard/admin/student-detail/${USER}`, params: { month: 10, year: 2026 }, body: undefined }]);
  assert.deepEqual([d.periodPoints, d.wallet?.balance, d.records.length], [2, 300, 2]);
});

test('flagRecord: posts exactly { recordId, status, reason }', async () => {
  answer = { status: 200, data: { message: 'Đã cập nhật trạng thái bản ghi thành EXCLUDED', data: { id: RECORD, status: 'EXCLUDED' } } };
  const r = await adminLeaderboardService.flagRecord({ recordId: RECORD, status: 'EXCLUDED', reason: 'trùng' });
  assert.deepEqual(calls, [{ method: 'post', url: '/api/learning/leaderboard/admin/flag-record', params: undefined, body: { recordId: RECORD, status: 'EXCLUDED', reason: 'trùng' } }]);
  assert.deepEqual(r, { message: 'Đã cập nhật trạng thái bản ghi thành EXCLUDED', status: 'EXCLUDED' });
});

test('flagRecord: 400 from the backend is passed on unchanged', async () => {
  answer = { status: 400, data: { error: 'Invalid record ID or status (must be SUSPECT, EXCLUDED, or VALID)' } };
  await assert.rejects(adminLeaderboardService.flagRecord({ recordId: RECORD, status: 'SUSPECT', reason: 'x' }), (err: any) => err.response.status === 400);
});

test('adjustPoints: posts exactly { targetUserId, amount, reason } once and reads newBalance', async () => {
  answer = { status: 200, data: { message: 'Điều chỉnh điểm thành công!', data: { tx: { id: 't9' }, newBalance: 400 } } };
  const r = await adminLeaderboardService.adjustPoints({ targetUserId: USER, amount: 100, reason: 'bù' });
  assert.deepEqual(calls, [{ method: 'post', url: '/api/learning/leaderboard/admin/adjust-points', params: undefined, body: { targetUserId: USER, amount: 100, reason: 'bù' } }]);
  assert.deepEqual(r, { message: 'Điều chỉnh điểm thành công!', newBalance: 400 });
});

test('adjustPoints: a 400 (e.g. negative balance) and a lost answer both reject after ONE request', async () => {
  answer = { status: 400, data: { error: 'Số dư sau điều chỉnh không thể âm (Hiện tại: 0, Điều chỉnh: -50)' } };
  await assert.rejects(adminLeaderboardService.adjustPoints({ targetUserId: USER, amount: -50, reason: 'x' }), (err: any) => err.response.status === 400);
  assert.equal(calls.length, 1);
  calls = [];
  learningApi.defaults.adapter = async (config: any) => {
    calls.push({ method: config.method, url: config.url, params: config.params, body: JSON.parse(config.data) });
    const err: any = new Error('Network Error');
    err.code = 'ERR_NETWORK';
    err.request = {};
    err.config = config;
    throw err;
  };
  await assert.rejects(adminLeaderboardService.adjustPoints({ targetUserId: USER, amount: 10, reason: 'x' }), (err: any) => err.response === undefined && isOutcomeUnknown(err));
  assert.equal(calls.length, 1, 'never resent');
});

test('getRewardTransactions / getAuditLogs: page and limit as query, parsed rows', async () => {
  answer = { status: 200, data: { data: transactionsData() } };
  const t = await adminLeaderboardService.getRewardTransactions(1, 50);
  answer = { status: 200, data: { data: auditData() } };
  const a = await adminLeaderboardService.getAuditLogs(1, 50);
  assert.deepEqual(calls, [
    { method: 'get', url: '/api/learning/leaderboard/admin/reward-transactions', params: { page: 1, limit: 50 }, body: undefined },
    { method: 'get', url: '/api/learning/leaderboard/admin/audit-logs', params: { page: 1, limit: 50 }, body: undefined },
  ]);
  assert.deepEqual([t.transactions[0].amount, t.transactions[0].description, t.pagination.total], [-500, 'Đổi khóa học', 2]);
  assert.deepEqual([a.logs[1].action, a.logs[1].month, a.logs[0].targetUserId], ['MANUAL_FINALIZE', 9, USER]);
});

test('getAuditLogs: 500 is passed on; a body in another shape is a contract error', async () => {
  answer = { status: 500, data: { error: 'Failed to get audit logs' } };
  await assert.rejects(adminLeaderboardService.getAuditLogs(), (err: any) => err.response.data.error === 'Failed to get audit logs');
  answer = { status: 200, data: { data: [] } };
  await assert.rejects(adminLeaderboardService.getAuditLogs(), LeaderboardContractError);
});

test('finalizeMonth: an error answer is passed on unchanged (the page reads it), with no retry', async () => {
  answer = { status: 409, data: { error: 'busy', message: 'busy', code: 'LEADERBOARD_BUSY' } };
  await assert.rejects(adminLeaderboardService.finalizeMonth({ month: 9, year: 2026 }), (err: any) => err.response.status === 409 && err.response.data.code === 'LEADERBOARD_BUSY');
  assert.equal(calls.length, 1);
});
