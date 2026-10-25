/**
 * Response bodies of the Learning Service admin leaderboard routes, built from admin-leaderboard.controller.ts and the Prisma
 * models it returns (FIX DEMO RANKING 02B). Shared by the unit and the service tests.
 */
export const USER = '6ad180dac2f4411a6c0a62a9';
export const RECORD = '66aa00000000000000000001';

/** AchievementService.syncExistingCompletions() */
export const syncData = () => ({
  processed: 4, totalExamined: 9, eligibleCount: 4, created: 3, skipped: 1, needsReview: 2, insufficientData: 0,
  details: { createdList: [], skippedList: [], needsReviewList: [], insufficientDataList: [] },
});

/** data of GET student-detail/:userId */
export const studentData = () => ({
  periodBreakdown: {
    userId: USER, month: 10, year: 2026, completedCoursesCount: 1, totalAchievementPoints: 2,
    records: [{ id: RECORD, courseId: 'c1', courseTitle: 'React', completedAt: '2026-10-20T03:00:00.000Z', totalDurationSeconds: 3600, durationHours: 1, level: 'BEGINNER', baseDurationPoints: 2, levelMultiplier: 1, achievementPoints: 2, averageQuizScore: 100, hasQuiz: true, pointsBreakdown: {} }],
  },
  rewardPoints: { id: 'w1', userId: USER, balance: 300, totalEarned: 500, totalSpent: 200, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' },
  allCompletions: [
    { id: RECORD, userId: USER, courseId: 'c1', courseTitle: 'React', completedAt: '2026-10-20T03:00:00.000Z', passed: true, totalDurationSeconds: 3600, level: 'BEGINNER', baseDurationPoints: 2, levelMultiplier: 1, achievementPoints: 2, averageQuizScore: 100, hasQuiz: true, policyVersion: '1.1', pointsBreakdown: {}, status: 'VALID', month: 10, year: 2026, createdAt: '2026-10-20T03:00:00.000Z', updatedAt: '2026-10-20T03:00:00.000Z' },
    { id: '66aa00000000000000000002', userId: USER, courseId: 'c2', courseTitle: 'Node', completedAt: '2026-09-02T03:00:00.000Z', passed: true, totalDurationSeconds: 0, level: 'ADVANCED', baseDurationPoints: 0, levelMultiplier: 1.2, achievementPoints: 0, averageQuizScore: null, hasQuiz: false, policyVersion: '1.1', pointsBreakdown: {}, status: 'SUSPECT', month: 9, year: 2026, createdAt: '2026-09-02T03:00:00.000Z', updatedAt: '2026-09-02T03:00:00.000Z' },
  ],
});

/** data of GET reward-transactions (rows enriched with fullName / avatar) */
export const transactionsData = () => ({
  transactions: [
    { id: 't2', userId: USER, amount: -500, type: 'COURSE_REDEMPTION', description: 'Đổi khóa học', balanceAfter: 500, sourceId: 'course1', idempotencyKey: 'k2', metadata: {}, createdAt: '2026-10-21T00:00:00.000Z', fullName: 'Jane Student', avatar: null },
    { id: 't1', userId: '0b495ad0ea56681649c710b4', amount: 1000, type: 'LEADERBOARD_REWARD', description: 'Thưởng Top 1 Bảng xếp hạng tháng 09/2026', balanceAfter: 1000, sourceId: null, idempotencyKey: 'k1', metadata: {}, createdAt: '2026-10-01T00:05:00.000Z', fullName: 'Học viên ẩn', avatar: null },
  ],
  pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
});

/** data of GET audit-logs */
export const auditData = () => ({
  logs: [
    { id: 'a2', adminId: '000000000000000000000001', adminEmail: 'admin@elearning.local', action: 'ADJUST_POINTS', targetUserId: USER, month: null, year: null, reason: 'Bù điểm', details: { amount: 100 }, createdAt: '2026-10-22T00:00:00.000Z' },
    { id: 'a1', adminId: '000000000000000000000000', adminEmail: 'system@umi.local', action: 'MANUAL_FINALIZE', targetUserId: null, month: 9, year: 2026, reason: 'Chốt', details: {}, createdAt: '2026-10-01T00:00:00.000Z' },
  ],
  pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
});
