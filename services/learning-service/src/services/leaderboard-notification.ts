/**
 * The leaderboard reward notification as one EVENT (FIX 06C-4B2B2): the idempotency key that names it and the text that describes
 * it, both derived only from data that is frozen for the period - so every attempt (finalize, startup / cron / reconcile retry,
 * admin retry, an old process or the one that took over) sends the same request.
 *
 * The User Service (FIX 06C-4B2B1) turns the key into the notification's _id: at most one notification exists per key, a replay is
 * answered 200 `deduplicated: true` and is not pushed again. Same key with a different userId / type / link is a contract
 * violation (422); a different title / message is accepted as a replay but the first text stays - hence the frozen sources below.
 */

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * `reward_lb_notify_<month>_<year>_<userId>` for the reward of `userId` in the leaderboard period month/year (the period being
 * processed - never the current month). Throws on any invalid input: there is no fallback key.
 */
export function rewardNotificationKey(month: number, year: number, userId: string): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error(`Invalid leaderboard month for a notification key: ${month}`);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`Invalid leaderboard year for a notification key: ${year}`);
  if (typeof userId !== 'string' || !OBJECT_ID.test(userId)) throw new Error('Invalid userId for a notification key (24 hex characters expected)');
  return `reward_lb_notify_${month}_${year}_${userId}`;
}

export interface FrozenRewardFacts {
  rank: number;           // the frozen snapshot rank
  points: number;         // the frozen achievement points of the snapshot entry
  rewardPoints: number;   // the amount the ledger confirms was paid for this period
  badgeName: string;      // the badge that was awarded for this period (as stored)
  icon: string;           // its icon (as stored)
}

/** The existing message format, filled from frozen facts only (no live scoring policy). */
export function buildRewardNotificationContent(month: number, year: number, facts: FrozenRewardFacts): { title: string; message: string } {
  const monthLabel = `${month.toString().padStart(2, '0')}/${year}`;
  return {
    title: `🏆 Chúc mừng! Bạn đạt ${facts.badgeName}`,
    message: `Bạn đạt thứ hạng #${facts.rank} trong Bảng xếp hạng tháng ${monthLabel} với ${facts.points} điểm thành tích và nhận được ${facts.rewardPoints} điểm thưởng cùng huy hiệu ${facts.icon}!`,
  };
}
