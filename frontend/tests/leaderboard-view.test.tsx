/**
 * FIX DEMO RANKING 02C.2: learner leaderboard page.
 *  - the scoring policy shown is the backend's own (compared with services/learning-service/src/config/scoring-policy.ts itself)
 *  - projected rewards (running period) are told apart from awarded ones (finalized snapshot)
 *  - the wallet and rank card, the reward history and the load-error panel have loading / error / empty states
 *  - the reward history is read from GET /api/learning/reward-points/transactions as the backend returns it
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).localStorage = { getItem: () => 'test-access-token', setItem: () => undefined, removeItem: () => undefined };

import { learningApi } from '../src/services/api';
import { leaderboardService } from '../src/services/leaderboard.service';
import {
  DESCRIBED_POLICY_VERSION,
  LEVEL_MULTIPLIERS,
  REWARD_TIERS,
  LeaderboardContractError,
  courseAchievementPoints,
  describeTransactionType,
  parseRewardHistory,
  readApiError,
  rewardColumnMode,
  transactionDirection,
} from '../src/utils/leaderboard-view';
import { LeaderboardLoadError, MyStatusCard, RewardHistoryPanel, ScoringPolicyContent } from '../src/components/leaderboard/LeaderboardPanels';
import * as backend from '../../services/learning-service/src/config/scoring-policy';

const noop = () => undefined;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** data of GET /api/learning/reward-points/transactions (RewardPointService.getTransactionHistory) */
const historyData = () => ({
  balance: 700,
  totalEarned: 1200,
  totalSpent: 500,
  transactions: [
    { id: 't2', userId: 'u1', amount: -500, type: 'COURSE_REDEMPTION', description: 'Đổi điểm lấy khóa học', balanceAfter: 700, sourceId: 'c1', idempotencyKey: 'k2', metadata: {}, createdAt: '2026-10-20T03:00:00.000Z' },
    { id: 't1', userId: 'u1', amount: 1200, type: 'LEADERBOARD_REWARD', description: 'Thưởng Top 1 Bảng xếp hạng tháng 09/2026', balanceAfter: 1200, sourceId: 'lb9', idempotencyKey: 'k1', metadata: {}, createdAt: '2026-10-01T00:05:00.000Z' },
  ],
  pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
});

describe('scoring policy shown = backend policy', () => {
  it('version, level multipliers and reward tiers are the backend ones', () => {
    assert.equal(DESCRIBED_POLICY_VERSION, backend.SCORING_POLICY_VERSION);
    for (const l of LEVEL_MULTIPLIERS) assert.equal(l.multiplier, backend.LEVEL_MULTIPLIERS[l.level], l.level);
    assert.deepEqual(LEVEL_MULTIPLIERS.map((l) => l.level).sort(), Object.keys(backend.LEVEL_MULTIPLIERS).sort());
    for (const [rank, tierIndex] of [[1, 0], [2, 1], [3, 2], [4, 3], [10, 3]] as const) {
      assert.equal(REWARD_TIERS[tierIndex].points, backend.getRewardForRank(rank, 9, 2026)!.rewardPoints, `rank ${rank}`);
      assert.ok(backend.getRewardForRank(rank, 9, 2026)!.badgeName.startsWith(REWARD_TIERS[tierIndex].badge), `badge rank ${rank}`);
    }
    assert.equal(backend.getRewardForRank(11, 9, 2026), null);
  });

  it('the worked-example arithmetic equals calculateCourseAchievementPoints for many durations and levels', () => {
    const durations = [0, -5, 1, 59, 900, 1799, 1800, 2700, 3599, 3600, 5400, 10800, 25200, 71999, 72000, 90000, 360000, Number.NaN];
    const levels = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'advanced ', 'EXPERT', ''];
    for (const d of durations) {
      for (const level of levels) {
        for (const approved of [true, false]) {
          const mine = courseAchievementPoints(d, level, approved);
          const theirs = backend.calculateCourseAchievementPoints(d, level, approved);
          assert.deepEqual(
            [mine.basePoints, mine.multiplier, mine.achievementPoints],
            [theirs.basePoints, theirs.levelMultiplier, theirs.achievementPoints],
            `${d}s ${JSON.stringify(level)} approved=${approved}`
          );
        }
      }
    }
  });

  it('the dialog describes the continuous v1.1 formula, not the old discrete tiers', () => {
    const t = text(renderToStaticMarkup(<ScoringPolicyContent serverPolicyVersion="1.1" />));
    assert.match(t, /min\(40, thời lượng \(giây\) ÷ 1800\)/);
    assert.match(t, /1 điểm cho mỗi 30 phút/);
    assert.match(t, /Khóa 3 giờ, Trung cấp 6 × 1\.1 = 6\.6 điểm/);
    assert.match(t, /Khóa 25 giờ, Nâng cao 40 × 1\.2 = 48 điểm/);
    assert.match(t, /Khóa 45 phút, Cơ bản 1\.5 × 1\.0 = 1\.5 điểm/);
    assert.match(t, /dưới 1 giây/);
    assert.doesNotMatch(t, /2h đến dưới 5h|30p đến dưới 2h|Dưới 30 phút/, 'the old step table is gone');
    assert.doesNotMatch(t, /chính sách v1\.0/);
  });

  it('a period computed with another policy version says so', () => {
    const t = text(renderToStaticMarkup(<ScoringPolicyContent serverPolicyVersion="1.0" />));
    assert.match(t, /mô tả chính sách v1\.1; kỳ đang xem được tính theo chính sách v1\.0/);
  });
});

describe('rewards: projected vs awarded', () => {
  it('only a FINALIZED period shows awarded rewards', () => {
    assert.equal(rewardColumnMode('FINALIZED'), 'AWARDED');
    for (const s of ['ACTIVE', 'SNAPSHOT_FROZEN', 'REWARDING', undefined, null]) assert.equal(rewardColumnMode(s as any), 'PROJECTED', String(s));
  });

  it('the page wires the column to the mode and no longer derives the month from the browser clock', () => {
    const src = readFileSync(path.join(process.cwd(), 'src', 'pages', 'Leaderboard.tsx'), 'utf8');
    assert.match(src, /rewardMode === 'AWARDED' \? 'Thưởng đã trao' : 'Thưởng dự kiến'/);
    assert.doesNotMatch(src, /getMonth\(\)|getFullYear\(\)/);
    assert.match(src, /setCurrentPeriod\(\{ month: data\.month, year: data\.year \}\)/);
  });
});

describe('reward point history', () => {
  it('parses the backend history page', () => {
    const h = parseRewardHistory(historyData());
    assert.deepEqual([h.balance, h.totalEarned, h.totalSpent, h.page, h.totalPages, h.total], [700, 1200, 500, 1, 1, 2]);
    assert.deepEqual(h.transactions.map((t) => [t.id, t.amount, t.type, t.balanceAfter]), [['t2', -500, 'COURSE_REDEMPTION', 700], ['t1', 1200, 'LEADERBOARD_REWARD', 1200]]);
    assert.equal(transactionDirection(-500), 'USED');
    assert.equal(transactionDirection(1200), 'RECEIVED');
    assert.equal(describeTransactionType('COURSE_REDEMPTION_REFUND'), 'Hoàn điểm đổi khóa');
  });

  it('a body in another shape is a contract error, missing totals stay null', () => {
    assert.throws(() => parseRewardHistory({ items: [] }), LeaderboardContractError);
    assert.throws(() => parseRewardHistory({ transactions: [{ id: 'x', points: 5, type: 'X' }] }), LeaderboardContractError);
    const raw: any = historyData();
    delete raw.totalSpent;
    assert.equal(parseRewardHistory(raw).totalSpent, null);
  });

  it('the service calls the existing route with page and limit', async () => {
    const calls: any[] = [];
    learningApi.defaults.adapter = (async (config: any) => {
      calls.push({ url: config.url, params: config.params });
      return { data: { data: historyData() }, status: 200, statusText: 'OK', headers: {}, config };
    }) as any;
    const page = await leaderboardService.getRewardTransactions(2, 20);
    assert.deepEqual(calls, [{ url: '/api/learning/reward-points/transactions', params: { page: 2, limit: 20 } }]);
    assert.equal(page.transactions.length, 2);
  });

  it('panel: loading, error with retry, empty, received vs used', () => {
    const base = { summary: null, canLoadMore: false, onRetry: noop, onLoadMore: noop };
    assert.match(text(renderToStaticMarkup(<RewardHistoryPanel {...base} items={null} loading error={null} />)), /Đang tải lịch sử điểm/);
    const err = text(renderToStaticMarkup(<RewardHistoryPanel {...base} items={null} loading={false} error="Failed to get transactions" />));
    assert.match(err, /Không tải được lịch sử điểm: Failed to get transactions/);
    assert.match(err, /Thử lại/);
    assert.doesNotMatch(err, /chưa có giao dịch/i, 'a failed request is not shown as an empty history');
    assert.match(text(renderToStaticMarkup(<RewardHistoryPanel {...base} items={[]} loading={false} error={null} />)), /Bạn chưa có giao dịch điểm thưởng nào/);
    const h = parseRewardHistory(historyData());
    const full = text(renderToStaticMarkup(<RewardHistoryPanel {...base} items={h.transactions} summary={h} loading={false} error={null} canLoadMore />));
    assert.match(full, /Đổi khóa học Dùng điểm Đổi điểm lấy khóa học/);
    assert.match(full, /-500/);
    assert.match(full, /Thưởng xếp hạng Nhận điểm/);
    assert.match(full, /\+1200/);
    assert.match(full, /Tổng đã nhận \+1\.200/);
    assert.match(full, /Tổng đã dùng −500/);
    assert.match(full, /Xem thêm/);
  });
});

describe('status card and load errors', () => {
  const props = { loading: false, onRetry: noop, onRedeem: noop, onShowHistory: noop, onShowBreakdown: noop };
  const wallet = { id: 'w', userId: 'u1', balance: 700, totalEarned: 1200, totalSpent: 500, courseRedemptionPoints: 500 };
  const rank = { rank: 2, isTie: false, points: 6.6, completedCourses: 1, averageScore: null, lastCompletedAt: null, totalParticipants: 5, scoreBreakdown: [] };

  it('the wallet is shown even when the rank (and the ranking) could not be loaded', () => {
    const t = text(renderToStaticMarkup(<MyStatusCard {...props} myRank={null} rankError="Bảng xếp hạng tạm thời chưa khả dụng" myPoints={wallet} pointsError={null} />));
    assert.match(t, /💎 700/);
    assert.match(t, /Không tải được thứ hạng của bạn: Bảng xếp hạng tạm thời chưa khả dụng/);
    assert.match(t, /Đổi khóa học/);
    assert.match(t, /Lịch sử điểm/);
    assert.match(t, /Thử lại/);
  });

  it('a failed wallet request says so and offers no redemption', () => {
    const t = text(renderToStaticMarkup(<MyStatusCard {...props} myRank={rank} rankError={null} myPoints={null} pointsError="Failed to get reward points" />));
    assert.match(t, /Không tải được ví điểm: Failed to get reward points/);
    assert.doesNotMatch(t, /Đổi khóa học|Lịch sử điểm/);
    assert.match(t, /Thứ hạng của bạn kỳ này: #2/);
  });

  it('loading states', () => {
    const t = text(renderToStaticMarkup(<MyStatusCard {...props} loading myRank={null} rankError={null} myPoints={null} pointsError={null} />));
    assert.match(t, /Đang tải thứ hạng/);
    assert.match(t, /Đang tải ví/);
  });

  it('the ranking error panel carries the message and a retry button', () => {
    const t = text(renderToStaticMarkup(<LeaderboardLoadError message="Bảng xếp hạng tạm thời chưa khả dụng" onRetry={noop} retrying={false} />));
    assert.match(t, /Không tải được bảng xếp hạng Bảng xếp hạng tạm thời chưa khả dụng Thử lại/);
  });

  it('readApiError: message, then error, then the network case', () => {
    assert.equal(readApiError({ response: { status: 503, data: { error: 'Bảng xếp hạng tạm thời chưa khả dụng' } } }, 'fb'), 'Bảng xếp hạng tạm thời chưa khả dụng');
    assert.equal(readApiError({ response: { data: { error: 'e', message: 'm' } } }, 'fb'), 'm');
    assert.match(readApiError({ request: {}, code: 'ERR_NETWORK' }, 'fb'), /Không kết nối được/);
    assert.equal(readApiError(new Error('x'), 'fb'), 'fb');
  });
});
