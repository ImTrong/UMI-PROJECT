/**
 * FIX 06C-4B2B2: the leaderboard reward notification as one event - its idempotency key, its frozen text, and how the shared client
 * carries the key (unit level; the flows are in leaderboard-finalize.test.ts and the multi-process crash suite).
 *
 * Run: npm test
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { useRandomInternalToken } from './helpers/internal-token';

/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require('axios').default || require('axios');
const { rewardNotificationKey, buildRewardNotificationContent } = require('../src/services/leaderboard-notification');
const { UserNotificationClient, UserNotificationError, IDEMPOTENCY_KEY_HEADER } = require('../src/services/user-notification.client');

const U = 'a1'.repeat(12);

describe('rewardNotificationKey(month, year, userId)', () => {
  it('has exactly the format the User Service checks: reward_lb_notify_<month>_<year>_<userId>', () => {
    assert.equal(rewardNotificationKey(9, 2026, U), `reward_lb_notify_9_2026_${U}`);
    assert.equal(rewardNotificationKey(12, 2025, U), `reward_lb_notify_12_2025_${U}`);
    assert.equal(rewardNotificationKey(1, 2000, U), `reward_lb_notify_1_2000_${U}`);
    assert.equal(rewardNotificationKey(1, 2100, U), `reward_lb_notify_1_2100_${U}`);
  });

  it('is stable: the same period and learner always give the same key, whatever the time or the process', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 10; i++) keys.add(rewardNotificationKey(9, 2026, U));
    assert.equal(keys.size, 1);
    const realNow = Date.now;
    try {
      Date.now = () => 0;
      assert.equal(rewardNotificationKey(9, 2026, U), `reward_lb_notify_9_2026_${U}`, 'the clock plays no role');
    } finally {
      Date.now = realNow;
    }
    assert.notEqual(rewardNotificationKey(9, 2026, U), rewardNotificationKey(10, 2026, U));
    assert.notEqual(rewardNotificationKey(9, 2026, U), rewardNotificationKey(9, 2027, U));
    assert.notEqual(rewardNotificationKey(9, 2026, U), rewardNotificationKey(9, 2026, 'b2'.repeat(12)));
  });

  it('throws on any invalid input - there is no fallback key', () => {
    const bad: Array<[any, any, any]> = [
      [0, 2026, U], [13, 2026, U], [9.5, 2026, U], ['9', 2026, U], [NaN, 2026, U], [undefined, 2026, U],
      [9, 1999, U], [9, 2101, U], [9, 2026.5, U], [9, '2026', U],
      [9, 2026, U.slice(1)], [9, 2026, `${U}0`], [9, 2026, 'z'.repeat(24)], [9, 2026, ''], [9, 2026, undefined], [9, 2026, `${U.slice(0, 23)} `],
    ];
    for (const [m, y, u] of bad) assert.throws(() => rewardNotificationKey(m, y, u), Error, `${m}/${y}/${u}`);
  });
});

describe('buildRewardNotificationContent', () => {
  it('fills the existing message format from frozen facts only', () => {
    const c = buildRewardNotificationContent(9, 2026, { rank: 1, points: 50, rewardPoints: 1000, badgeName: 'Nhà vô địch tháng 09/2026', icon: '🥇' });
    assert.equal(c.title, '🏆 Chúc mừng! Bạn đạt Nhà vô địch tháng 09/2026');
    assert.equal(c.message, 'Bạn đạt thứ hạng #1 trong Bảng xếp hạng tháng 09/2026 với 50 điểm thành tích và nhận được 1000 điểm thưởng cùng huy hiệu 🥇!');
  });
});

describe('UserNotificationClient: the optional idempotency key', () => {
  let calls: Array<{ config: any }> = [];
  let answer: any = { status: 201, data: {} };
  const saved = process.env.INTERNAL_SERVICE_TOKEN;
  let token = '';
  beforeEach(() => {
    token = useRandomInternalToken();
    process.env.USER_SERVICE_URL = 'http://user-service.test:3002';
    calls = [];
    answer = { status: 201, data: {} };
    mock.method(axios, 'post', async (_url: string, _body: any, config: any) => { calls.push({ config }); return answer; });
  });
  afterEach(() => { mock.restoreAll(); process.env.INTERNAL_SERVICE_TOKEN = saved; });
  const body = () => ({ userId: U, title: 't', message: 'm', type: 'SUCCESS', link: '/leaderboard' });

  it('with a key: X-Idempotency-Key is sent next to the token, nothing else changes', async () => {
    await UserNotificationClient.send(body(), { timeoutMs: 5000, idempotencyKey: rewardNotificationKey(9, 2026, U) });
    assert.equal(IDEMPOTENCY_KEY_HEADER, 'x-idempotency-key');
    assert.deepEqual(calls[0].config, { headers: { 'x-internal-service-token': token, 'x-idempotency-key': `reward_lb_notify_9_2026_${U}` }, timeout: 5000 });
  });

  it('without a key: no idempotency header at all (the other callers are unchanged)', async () => {
    await UserNotificationClient.send(body());
    assert.deepEqual(Object.keys(calls[0].config.headers), ['x-internal-service-token']);
  });

  it('an invalid key: a CONFIG error and NO request', async () => {
    for (const key of ['', ' ', 'a b', 'k\nx', 'x'.repeat(201), 'k,k', 'é']) {
      await assert.rejects(UserNotificationClient.send(body(), { idempotencyKey: key }), (e: any) => e instanceof UserNotificationError && e.failure === 'CONFIG');
    }
    assert.equal(calls.length, 0);
  });

  it('a missing token still sends nothing, key or not', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    await assert.rejects(UserNotificationClient.send(body(), { idempotencyKey: rewardNotificationKey(9, 2026, U) }), (e: any) => e.failure === 'CONFIG');
    assert.equal(calls.length, 0);
  });

  it('HTTP 200 deduplicated is a success exactly like 201 created', async () => {
    answer = { status: 200, data: { deduplicated: true } };
    assert.deepEqual(await UserNotificationClient.send(body(), { idempotencyKey: rewardNotificationKey(9, 2026, U) }), { status: 200 });
    answer = { status: 201, data: { deduplicated: false } };
    assert.deepEqual(await UserNotificationClient.send(body(), { idempotencyKey: rewardNotificationKey(9, 2026, U) }), { status: 201 });
  });

  it('HTTP 422 (key reused for another notification) is a failure the caller sees - with its status, not hidden', async () => {
    mock.restoreAll();
    mock.method(axios, 'post', async () => { throw Object.assign(new Error('Request failed with status code 422'), { response: { status: 422 }, config: { headers: { 'x-internal-service-token': token } } }); });
    await assert.rejects(UserNotificationClient.send(body(), { idempotencyKey: rewardNotificationKey(9, 2026, U) }), (e: any) => e.status === 422 && e.failure === 'HTTP' && !JSON.stringify(e).includes(token));
  });
});
