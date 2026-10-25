/**
 * FIX DEMO RANKING 02B: admin actions read and send the Learning Service contract as the controllers define it. Fixtures mirror
 * admin-leaderboard.controller.ts (syncCompletions, getStudentAudit, flagRecord, adjustPoints, getAuditLogs, getRewardTransactions)
 * and the Prisma models they return (CourseCompletionRecord, UserRewardPoint, RewardPointTransaction, LeaderboardAuditLog).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdminInputError,
  buildAdjustRequest,
  buildFlagRequest,
  describeAuditAction,
  describeSyncResult,
  describeTransactionType,
  describeWriteError,
  isOutcomeUnknown,
  parseAdjustResult,
  parseAuditLogsPage,
  parseFlagResult,
  parseStudentDetail,
  parseSyncResult,
  parseTransactionsPage,
} from '../src/utils/leaderboard-admin';
import { LeaderboardContractError } from '../src/utils/leaderboard-period';

import { RECORD, USER, auditData, studentData, syncData, transactionsData } from './fixtures/admin-leaderboard';

describe('requests', () => {
  test('flag-record body is { recordId, status, reason } with a trimmed reason', () => {
    assert.deepEqual(buildFlagRequest(RECORD, 'SUSPECT', '  nghi vấn  '), { recordId: RECORD, status: 'SUSPECT', reason: 'nghi vấn' });
    assert.deepEqual(buildFlagRequest(RECORD, 'VALID', 'khôi phục'), { recordId: RECORD, status: 'VALID', reason: 'khôi phục' });
    assert.throws(() => buildFlagRequest(RECORD, 'FLAGGED', 'x'), AdminInputError);
    assert.throws(() => buildFlagRequest(RECORD, 'SUSPECT', '   '), AdminInputError);
    assert.throws(() => buildFlagRequest('r1', 'SUSPECT', 'x'), AdminInputError);
    assert.equal('isFlagged' in buildFlagRequest(RECORD, 'EXCLUDED', 'x'), false);
  });

  test('adjust-points body is { targetUserId, amount, reason } with a whole, non-zero amount', () => {
    assert.deepEqual(buildAdjustRequest(USER, ' -50 ', ' bù trừ '), { targetUserId: USER, amount: -50, reason: 'bù trừ' });
    assert.deepEqual(buildAdjustRequest(USER, '+100', 'thưởng'), { targetUserId: USER, amount: 100, reason: 'thưởng' });
    for (const bad of ['0', '10.5', '5.0', '1e3', 'abc', '', '99999999999999999999']) {
      assert.throws(() => buildAdjustRequest(USER, bad, 'x'), AdminInputError, `amount ${JSON.stringify(bad)}`);
    }
    assert.throws(() => buildAdjustRequest(USER, '10', ' '), AdminInputError);
    assert.throws(() => buildAdjustRequest('not-an-id', '10', 'x'), AdminInputError);
    const body = buildAdjustRequest(USER, '10', 'x') as any;
    assert.equal(body.userId, undefined);
    assert.equal(body.points, undefined);
  });
});

describe('answers', () => {
  test('sync result: created / skipped / needsReview / insufficientData', () => {
    const r = parseSyncResult(syncData());
    assert.deepEqual(r, { created: 3, skipped: 1, needsReview: 2, insufficientData: 0, totalExamined: 9 });
    assert.equal(describeSyncResult(r), 'Đồng bộ hoàn tất: 3 bản ghi thành tích mới, bỏ qua 1 bản ghi đã có, 2 tiến trình cần rà soát (đã xét 9 tiến trình).');
    assert.throws(() => parseSyncResult({ syncedCount: 3, skippedCount: 1 }), LeaderboardContractError, 'the old field names are a contract error');
  });

  test('student detail: period breakdown, wallet and every completion record with its status', () => {
    const d = parseStudentDetail(studentData());
    assert.deepEqual([d.userId, d.month, d.year, d.periodPoints, d.periodCourses], [USER, 10, 2026, 2, 1]);
    assert.deepEqual(d.wallet, { balance: 300, totalEarned: 500, totalSpent: 200 });
    assert.equal(d.records.length, 2, 'allCompletions, not only the VALID records of the period');
    assert.deepEqual(
      [d.records[1].status, d.records[1].month, d.records[1].achievementPoints, d.records[1].totalDurationSeconds, d.records[1].averageQuizScore],
      ['SUSPECT', 9, 0, 0, null]
    );
    assert.equal(d.records[0].courseTitle, 'React');
  });

  test('student detail: a missing wallet stays null, missing numbers stay null; the old shape is rejected', () => {
    const raw: any = studentData();
    raw.rewardPoints = null;
    delete raw.periodBreakdown.totalAchievementPoints;
    const d = parseStudentDetail(raw);
    assert.equal(d.wallet, null);
    assert.equal(d.periodPoints, null);
    assert.throws(() => parseStudentDetail({ userId: USER, totalMonthlyPoints: 3, records: [] }), LeaderboardContractError);
    const noStatus: any = studentData();
    delete noStatus.allCompletions[0].status;
    assert.throws(() => parseStudentDetail(noStatus), /status/);
  });

  test('transactions: amount, description, balanceAfter, sourceId; the "unknown learner" placeholder becomes null', () => {
    const { transactions, pagination } = parseTransactionsPage(transactionsData());
    assert.deepEqual(
      transactions.map((t) => [t.id, t.amount, t.type, t.description, t.balanceAfter, t.sourceId, t.fullName]),
      [
        ['t2', -500, 'COURSE_REDEMPTION', 'Đổi khóa học', 500, 'course1', 'Jane Student'],
        ['t1', 1000, 'LEADERBOARD_REWARD', 'Thưởng Top 1 Bảng xếp hạng tháng 09/2026', 1000, null, null],
      ]
    );
    assert.deepEqual(pagination, { page: 1, limit: 50, total: 2, totalPages: 1 });
    assert.equal(describeTransactionType('COURSE_REDEMPTION_REFUND'), 'Hoàn điểm đổi khóa');
    assert.equal(describeTransactionType('SOMETHING_NEW'), 'SOMETHING_NEW');
    assert.throws(() => parseTransactionsPage({ transactions: [{ id: 'x', userId: USER, points: 5, type: 'ADMIN_ADJUSTMENT' }] }), LeaderboardContractError, 'points instead of amount');
    assert.throws(() => parseTransactionsPage({ items: [] }), LeaderboardContractError);
  });

  test('audit logs: adminEmail, targetUserId and the period; no targetType/targetId', () => {
    const { logs, pagination } = parseAuditLogsPage(auditData());
    assert.deepEqual(
      logs.map((l) => [l.action, l.adminEmail, l.targetUserId, l.month, l.year, l.reason]),
      [
        ['ADJUST_POINTS', 'admin@elearning.local', USER, null, null, 'Bù điểm'],
        ['MANUAL_FINALIZE', 'system@umi.local', null, 9, 2026, 'Chốt'],
      ]
    );
    assert.equal(pagination.total, 2);
    assert.equal(describeAuditAction('FLAG_STUDENT'), 'Gắn cờ bản ghi');
    assert.throws(() => parseAuditLogsPage({ logs: [{ id: 'a', targetType: 'USER' }] }), LeaderboardContractError);
  });

  test('flag and adjust answers', () => {
    assert.deepEqual(parseFlagResult({ message: 'Đã cập nhật trạng thái bản ghi thành SUSPECT', data: { id: RECORD, status: 'SUSPECT' } }), { message: 'Đã cập nhật trạng thái bản ghi thành SUSPECT', status: 'SUSPECT' });
    assert.deepEqual(parseAdjustResult({ message: 'Điều chỉnh điểm thành công!', data: { tx: { id: 't9' }, newBalance: 400 } }), { message: 'Điều chỉnh điểm thành công!', newBalance: 400 });
    assert.equal(parseAdjustResult({ message: 'ok', data: { tx: {} } }).newBalance, null);
    assert.throws(() => parseAdjustResult({ data: { newBalance: 1 } }), LeaderboardContractError);
  });
});

describe('write errors', () => {
  test('a backend answer (4xx / 5xx) is a definite failure and shows its message', () => {
    const e400 = { response: { status: 400, data: { error: 'Số dư sau điều chỉnh không thể âm (Hiện tại: 0, Điều chỉnh: -50)' } } };
    assert.match(describeWriteError(e400, 'fb').message, /không thể âm/);
    assert.equal(isOutcomeUnknown(e400), false);
    const e500 = { response: { status: 500, data: { error: 'Failed to update record status' } } };
    assert.equal(describeWriteError(e500, 'fb').message, 'Failed to update record status');
    assert.equal(isOutcomeUnknown(e500), false);
  });

  test('no answer or an unreadable answer: the outcome is unknown and said so', () => {
    const net = { request: {}, code: 'ERR_NETWORK' };
    assert.equal(isOutcomeUnknown(net), true);
    assert.match(describeWriteError(net, 'fb').message, /chưa xác định/);
    const contract = new LeaderboardContractError('phản hồi điều chỉnh điểm thiếu message');
    assert.equal(isOutcomeUnknown(contract), true);
    assert.match(describeWriteError(contract, 'fb').message, /chưa xác định/);
    const input = new AdminInputError('Số điểm phải là số nguyên');
    assert.equal(isOutcomeUnknown(input), false);
    assert.equal(describeWriteError(input, 'fb').message, 'Số điểm phải là số nguyên');
  });
});
