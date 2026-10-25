import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * IMPLEMENT-01 - becoming an instructor:  STUDENT -> application PENDING -> an ADMIN approves (role INSTRUCTOR) or rejects (stays
 * STUDENT, may apply again). Registration is free. Every identity comes from the authenticated request: the applicant is the
 * caller of submit(), the reviewer is the caller of approve() / reject(); ids, roles or reviewers in a body are never used.
 * At most one PENDING application per user: checked here and enforced by the unique pendingKey (= userId while pending).
 */
export class InstructorApplicationError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly code: string) {
    super(message);
    this.name = 'InstructorApplicationError';
  }
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
export const EXPERTISE_MIN = 2;
export const EXPERTISE_MAX = 200;
export const MOTIVATION_MAX = 2000;
export const REJECTION_REASON_MIN = 3;
export const REJECTION_REASON_MAX = 1000;
export const LEGACY_PAYMENT_EXPERTISE = 'Đã thanh toán phí đăng ký giảng viên (luồng cũ) - cần bổ sung lĩnh vực chuyên môn';
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

const closedKey = (id: string) => `closed:${id}`;
const isUniqueViolation = (error: any) => error?.code === 'P2002';

function cleanText(value: unknown, field: string, min: number, max: number, required: boolean): string | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '' && !required)) {
    if (required) throw new InstructorApplicationError(`${field} is required`, 400, 'INVALID_INPUT');
    return undefined;
  }
  if (typeof value !== 'string') throw new InstructorApplicationError(`${field} must be text`, 400, 'INVALID_INPUT');
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new InstructorApplicationError(`${field} must be ${min}-${max} characters`, 400, 'INVALID_INPUT');
  }
  return text;
}

export class InstructorApplicationService {
  /** The applicant's own application input: expertise (required) and an optional motivation. */
  static validateSubmission(body: any): { expertise: string; motivation?: string } {
    const expertise = cleanText(body?.expertise, 'expertise', EXPERTISE_MIN, EXPERTISE_MAX, true)!;
    const motivation = cleanText(body?.motivation ?? body?.bio, 'motivation', 1, MOTIVATION_MAX, false);
    return { expertise, motivation };
  }

  /** A STUDENT (no other role) without a pending application files one; nothing about the role changes. */
  static async submit(userId: string, input: { expertise: string; motivation?: string }, source: 'FORM' | 'LEGACY_PAYMENT' = 'FORM') {
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { id: true, role: true } });
    if (!profile) throw new InstructorApplicationError('User profile not found', 404, 'PROFILE_NOT_FOUND');
    if (profile.role !== 'STUDENT') {
      throw new InstructorApplicationError(
        profile.role === 'INSTRUCTOR' ? 'Bạn đã là giảng viên rồi' : 'Tài khoản này không thể đăng ký giảng viên',
        409, 'NOT_A_STUDENT'
      );
    }
    const pending = await prisma.instructorApplication.findFirst({ where: { userId, status: 'PENDING' } });
    if (pending) throw new InstructorApplicationError('Bạn đã có một đơn đăng ký đang chờ duyệt', 409, 'APPLICATION_PENDING');
    try {
      const application = await prisma.instructorApplication.create({
        data: { userId, expertise: input.expertise, motivation: input.motivation, status: 'PENDING', source, pendingKey: userId },
      });
      logger.info(`Instructor application ${application.id} submitted by ${userId} (${source})`);
      return application;
    } catch (error: any) {
      // two submissions at the same instant: the unique pendingKey lets exactly one through
      if (isUniqueViolation(error)) throw new InstructorApplicationError('Bạn đã có một đơn đăng ký đang chờ duyệt', 409, 'APPLICATION_PENDING');
      throw error;
    }
  }

  /** The caller's own latest application (or null) and current role. */
  static async getMine(userId: string) {
    const [profile, latest] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId }, select: { role: true } }),
      prisma.instructorApplication.findFirst({ where: { userId }, orderBy: { submittedAt: 'desc' } }),
    ]);
    return { role: profile?.role || 'STUDENT', application: latest ? this.toApplicantView(latest) : null };
  }

  /** What the applicant sees of their application (no reviewer id). */
  static toApplicantView(a: any) {
    return {
      id: a.id, status: a.status, expertise: a.expertise, motivation: a.motivation ?? null, source: a.source,
      submittedAt: a.submittedAt, reviewedAt: a.reviewedAt ?? null, rejectionReason: a.rejectionReason ?? null,
    };
  }

  /** ADMIN list, newest first, with the applicant's name / email / current role. */
  static async list(status: unknown, page: number, limit: number) {
    const where: any = {};
    if (status !== undefined && status !== '') {
      if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
        throw new InstructorApplicationError('Invalid status filter', 400, 'INVALID_INPUT');
      }
      where.status = status;
    }
    const take = Math.min(Math.max(Number.isFinite(limit) ? Math.floor(limit) : 20, 1), 100);
    const p = Math.max(Number.isFinite(page) ? Math.floor(page) : 1, 1);
    const [items, total] = await Promise.all([
      prisma.instructorApplication.findMany({ where, orderBy: { submittedAt: 'desc' }, skip: (p - 1) * take, take }),
      prisma.instructorApplication.count({ where }),
    ]);
    const userIds = [...new Set(items.map((a: any) => a.userId))];
    const profiles = userIds.length
      ? await prisma.userProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, fullName: true, email: true, avatar: true, role: true } })
      : [];
    const byUser = new Map(profiles.map((pr: any) => [pr.userId, pr]));
    return {
      data: items.map((a: any) => ({ ...this.toApplicantView(a), userId: a.userId, reviewedBy: a.reviewedBy ?? null, applicant: byUser.get(a.userId) ?? null })),
      pagination: { page: p, limit: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  /** Closes a PENDING application exactly once (a concurrent second decision finds it no longer pending). */
  private static async close(applicationId: string, reviewerId: string, data: Record<string, unknown>) {
    if (typeof applicationId !== 'string' || !OBJECT_ID.test(applicationId)) {
      throw new InstructorApplicationError('Application not found', 404, 'APPLICATION_NOT_FOUND');
    }
    const application = await prisma.instructorApplication.findUnique({ where: { id: applicationId } });
    if (!application) throw new InstructorApplicationError('Application not found', 404, 'APPLICATION_NOT_FOUND');
    if (application.status !== 'PENDING') throw new InstructorApplicationError('Application was already reviewed', 409, 'APPLICATION_ALREADY_REVIEWED');
    const result = await prisma.instructorApplication.updateMany({
      where: { id: applicationId, status: 'PENDING' },
      data: { ...data, reviewedBy: reviewerId, reviewedAt: new Date(), pendingKey: closedKey(applicationId) },
    });
    if (result.count !== 1) throw new InstructorApplicationError('Application was already reviewed', 409, 'APPLICATION_ALREADY_REVIEWED');
    return application;
  }

  /** ADMIN approval: the application is APPROVED and a STUDENT applicant becomes INSTRUCTOR (an ADMIN is never downgraded). */
  static async approve(applicationId: string, reviewerId: string) {
    const application = await this.close(applicationId, reviewerId, { status: 'APPROVED', rejectionReason: null });
    const profile = await prisma.userProfile.findUnique({ where: { userId: application.userId } });
    if (profile && profile.role === 'STUDENT') {
      await prisma.userProfile.update({ where: { userId: application.userId }, data: { role: 'INSTRUCTOR' } });
    }
    if (profile) {
      await prisma.notification.create({
        data: {
          userId: profile.id,
          title: 'Đơn đăng ký giảng viên đã được duyệt',
          message: 'Chào mừng bạn gia nhập đội ngũ Giảng viên UMI! Bạn có thể bắt đầu tạo khóa học ngay bây giờ.',
          type: 'SUCCESS',
          link: '/instructor/dashboard',
        },
      }).catch((e: any) => logger.warn(`Approval notification not created: ${e?.message}`));
    }
    logger.info(`Instructor application ${applicationId} approved by ${reviewerId}`);
    return prisma.instructorApplication.findUnique({ where: { id: applicationId } });
  }

  /** ADMIN rejection with a reason; the role stays as it is. */
  static async reject(applicationId: string, reviewerId: string, reasonInput: unknown) {
    const reason = cleanText(reasonInput, 'reason', REJECTION_REASON_MIN, REJECTION_REASON_MAX, true)!;
    const application = await this.close(applicationId, reviewerId, { status: 'REJECTED', rejectionReason: reason });
    const profile = await prisma.userProfile.findUnique({ where: { userId: application.userId }, select: { id: true } });
    if (profile) {
      await prisma.notification.create({
        data: {
          userId: profile.id,
          title: 'Đơn đăng ký giảng viên chưa được duyệt',
          message: `Lý do: ${reason}. Bạn có thể bổ sung thông tin và gửi lại đơn.`,
          type: 'WARNING',
          link: '/become-instructor',
        },
      }).catch((e: any) => logger.warn(`Rejection notification not created: ${e?.message}`));
    }
    logger.info(`Instructor application ${applicationId} rejected by ${reviewerId}`);
    return prisma.instructorApplication.findUnique({ where: { id: applicationId } });
  }

  /**
   * A registration fee paid through the old payment flow (payment-service -> /become-instructor/confirm): no role change any more;
   * the learner gets a PENDING application for an ADMIN to review (idempotent - nothing new if one is already pending or the user
   * is no longer a STUDENT).
   */
  static async fromLegacyPayment(userId: string) {
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { role: true } });
    if (!profile || profile.role !== 'STUDENT') return { queued: false as const, reason: profile ? 'NOT_A_STUDENT' : 'PROFILE_NOT_FOUND' };
    const pending = await prisma.instructorApplication.findFirst({ where: { userId, status: 'PENDING' } });
    if (pending) return { queued: true as const, application: pending };
    try {
      const application = await this.submit(userId, { expertise: LEGACY_PAYMENT_EXPERTISE }, 'LEGACY_PAYMENT');
      return { queued: true as const, application };
    } catch (error) {
      if (error instanceof InstructorApplicationError && error.code === 'APPLICATION_PENDING') {
        return { queued: true as const, application: await prisma.instructorApplication.findFirst({ where: { userId, status: 'PENDING' } }) };
      }
      throw error;
    }
  }
}
