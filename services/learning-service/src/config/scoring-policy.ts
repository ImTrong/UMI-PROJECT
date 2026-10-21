/**
 * Centralized Scoring Policy for UMI E-learning Monthly Leaderboard
 *
 * Implements:
 * 1. Base Duration Points:
 *    - Under 30 mins (< 1800s): 2 points
 *    - 30 mins to under 2 hrs (1800s - 7199s): 5 points
 *    - 2 hrs to under 5 hrs (7200s - 17999s): 10 points
 *    - 5 hrs to under 10 hrs (18000s - 35999s): 20 points
 *    - 10 hrs to under 20 hrs (36000s - 71999s): 30 points
 *    - 20 hrs and above (>= 72000s): 40 points
 *
 * 2. Course Level Multipliers:
 *    - BEGINNER: 1.0
 *    - INTERMEDIATE: 1.1
 *    - ADVANCED: 1.2
 *    - Unverified / default: 1.0
 *
 * 3. Course Achievement Points = round(BaseDurationPoints * LevelMultiplier, 2)
 *
 * 4. Monthly Rewards:
 *    - Rank 1: 1,000 points, "Nhà vô địch tháng MM/YYYY", 🥇
 *    - Rank 2: 700 points, "Á quân tháng MM/YYYY", 🥈
 *    - Rank 3: 500 points, "Top 3 tháng MM/YYYY", 🥉
 *    - Rank 4-10: 200 points each, "Top 10 tháng MM/YYYY", 🎖️
 *
 * 5. Timezone: Asia/Ho_Chi_Minh (UTC+7)
 */

export const SCORING_POLICY_VERSION = '1.1';

export interface DurationTier {
  minSeconds: number;
  maxSeconds: number; // Infinity for open ended
  basePoints: number;
  label: string;
}

export const DURATION_TIERS: DurationTier[] = [
  { minSeconds: 0, maxSeconds: 1800, basePoints: 2, label: 'Dưới 30 phút' },
  { minSeconds: 1800, maxSeconds: 7200, basePoints: 5, label: 'Từ 30 phút đến dưới 2 giờ' },
  { minSeconds: 7200, maxSeconds: 18000, basePoints: 10, label: 'Từ 2 giờ đến dưới 5 giờ' },
  { minSeconds: 18000, maxSeconds: 36000, basePoints: 20, label: 'Từ 5 giờ đến dưới 10 giờ' },
  { minSeconds: 36000, maxSeconds: 72000, basePoints: 30, label: 'Từ 10 giờ đến dưới 20 giờ' },
  { minSeconds: 72000, maxSeconds: Infinity, basePoints: 40, label: 'Từ 20 giờ trở lên' },
];

export const LEVEL_MULTIPLIERS: Record<string, number> = {
  BEGINNER: 1.0,
  INTERMEDIATE: 1.1,
  ADVANCED: 1.2,
};

export interface RewardConfig {
  rank: number;
  maxRank?: number; // for ranges like 4-10
  rewardPoints: number;
  badgeTitlePrefix: string;
  icon: string;
}

export const REWARD_TIERS: RewardConfig[] = [
  { rank: 1, rewardPoints: 1000, badgeTitlePrefix: 'Nhà vô địch tháng', icon: '🥇' },
  { rank: 2, rewardPoints: 700, badgeTitlePrefix: 'Á quân tháng', icon: '🥈' },
  { rank: 3, rewardPoints: 500, badgeTitlePrefix: 'Top 3 tháng', icon: '🥉' },
  { rank: 4, maxRank: 10, rewardPoints: 200, badgeTitlePrefix: 'Top 10 tháng', icon: '🎖️' },
];

/**
 * Continuous Base Points formula (Policy v1.1):
 * basePoints = min(40, totalDurationSeconds / 1800)
 *
 * Linearly awards 1 base point per 30 minutes (1800s) = 2 base points per hour,
 * smoothly without step-jump unfairness, capped at 40 points (20 hours).
 * Returns 0 if duration is missing, zero, negative, or invalid.
 */
export function calculateBasePoints(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }
  const rawPoints = Math.min(40, durationSeconds / 1800);
  return Math.round(rawPoints * 100) / 100;
}

/**
 * Calculate base duration points from total course duration in seconds.
 * Handles missing, zero, negative, or abnormal durations safely.
 * Returns continuous base points (v1.1) along with tier label for backward compatibility and display.
 */
export function getBaseDurationPoints(durationSeconds: number): {
  basePoints: number;
  tierLabel: string;
  validSeconds: number;
  discreteBasePoints: number;
} {
  // Sanitize: negative or NaN -> clamp to 0
  const validSeconds = Math.max(0, Number.isFinite(durationSeconds) ? Math.floor(durationSeconds) : 0);
  if (validSeconds <= 0) {
    return {
      basePoints: 0,
      tierLabel: 'Không có dữ liệu thời lượng hợp lệ',
      validSeconds: 0,
      discreteBasePoints: 0,
    };
  }

  // Calculate discrete points for reference
  let discreteBasePoints = 40;
  let tierLabel = 'Từ 20 giờ trở lên';
  for (const tier of DURATION_TIERS) {
    if (validSeconds >= tier.minSeconds && validSeconds < tier.maxSeconds) {
      discreteBasePoints = tier.basePoints;
      tierLabel = tier.label;
      break;
    }
  }

  // Continuous points (Policy v1.1): smooth progression
  const basePoints = calculateBasePoints(validSeconds);

  return {
    basePoints,
    tierLabel,
    validSeconds,
    discreteBasePoints,
  };
}

/**
 * Get level multiplier for a course.
 * Defaults to 1.0 if level is unverified, missing, or course is not approved.
 */
export function getLevelMultiplier(level?: string | null, isApproved: boolean = true): number {
  if (!isApproved || !level) {
    return 1.0;
  }
  const normalized = level.toUpperCase().trim();
  return LEVEL_MULTIPLIERS[normalized] ?? 1.0;
}

export interface AchievementCalculationResult {
  durationSeconds: number;
  durationHours: number;
  basePoints: number;
  tierLabel: string;
  level: string;
  levelMultiplier: number;
  achievementPoints: number;
  policyVersion: string;
}

/**
 * Calculate final course achievement points with continuous scoring (Policy v1.1).
 * coursePoints = round(basePoints * levelMultiplier, 2)
 */
export function calculateCourseAchievementPoints(
  durationSeconds: number,
  level?: string | null,
  isApproved: boolean = true
): AchievementCalculationResult {
  const { basePoints, tierLabel, validSeconds } = getBaseDurationPoints(durationSeconds);
  const normalizedLevel = (level || 'BEGINNER').toUpperCase().trim();
  const levelMultiplier = getLevelMultiplier(normalizedLevel, isApproved);
  const rawPoints = basePoints * levelMultiplier;
  const achievementPoints = Math.round(rawPoints * 100) / 100;
  const durationHours = Math.round((validSeconds / 3600) * 100) / 100;

  return {
    durationSeconds: validSeconds,
    durationHours,
    basePoints,
    tierLabel,
    level: normalizedLevel,
    levelMultiplier,
    achievementPoints,
    policyVersion: SCORING_POLICY_VERSION,
  };
}

/**
 * Get reward tier config for a specific rank.
 */
export function getRewardForRank(rank: number, month: number, year: number): {
  rewardPoints: number;
  badgeName: string;
  icon: string;
  description: string;
} | null {
  if (rank < 1) return null;
  const monthStr = month.toString().padStart(2, '0');
  const monthLabel = `${monthStr}/${year}`;

  for (const tier of REWARD_TIERS) {
    if (tier.maxRank) {
      if (rank >= tier.rank && rank <= tier.maxRank) {
        return {
          rewardPoints: tier.rewardPoints,
          badgeName: `${tier.badgeTitlePrefix} ${monthLabel}`,
          icon: tier.icon,
          description: `Đạt thứ hạng #${rank} trong Bảng xếp hạng tháng ${monthLabel}`,
        };
      }
    } else if (tier.rank === rank) {
      return {
        rewardPoints: tier.rewardPoints,
        badgeName: `${tier.badgeTitlePrefix} ${monthLabel}`,
        icon: tier.icon,
        description: `Đạt thứ hạng #${rank} trong Bảng xếp hạng tháng ${monthLabel}`,
      };
    }
  }

  return null;
}

/**
 * Timezone helpers for Asia/Ho_Chi_Minh (UTC+7)
 * Returns the exact Date range in UTC corresponding to:
 * Start: YYYY-MM-01 00:00:00.000 (UTC+7)
 * End:   YYYY-MM-LastDay 23:59:59.999 (UTC+7)
 */
export function getVietnamMonthRange(month: number, year: number): { start: Date; end: Date } {
  // In UTC+7:
  // 00:00:00 on day 1 of month in UTC+7 is (day 1, 00:00:00 - 7 hours) in UTC
  // = prev day 17:00:00 UTC
  // Construct via ISO string with timezone offset +07:00
  const monthStr = month.toString().padStart(2, '0');
  const startIso = `${year}-${monthStr}-01T00:00:00.000+07:00`;
  const start = new Date(startIso);

  // For end date: first day of next month 00:00:00.000 +07:00 minus 1 millisecond
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear = year + 1;
  }
  const nextMonthStr = nextMonth.toString().padStart(2, '0');
  const nextStartIso = `${nextYear}-${nextMonthStr}-01T00:00:00.000+07:00`;
  const end = new Date(new Date(nextStartIso).getTime() - 1);

  return { start, end };
}

/**
 * Get current month and year in Asia/Ho_Chi_Minh timezone
 */
export function getCurrentVietnamMonthYear(date: Date = new Date()): { month: number; year: number } {
  // Convert date to VN time string
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '2026', 10);

  return { month, year };
}
