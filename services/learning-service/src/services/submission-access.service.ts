import { PrismaClient } from '@prisma/client';
import { CourseAccessService, CourseAccessError } from './course-access.service';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * FIX-INS-09 - who may list, read, grade or (re)evaluate submissions. One rule for the submission APIs and for the file download
 * (LearningFileAccessService, FIX-INS-08), always from server-side data and the caller authenticated by the middleware.
 *
 *   Assignment grader      ADMIN, or an INSTRUCTOR who OWNS the course the assignment's lesson really belongs to - lesson ->
 *                          course -> instructorId from the course-service internal route (any course status, FIX-INS-10) - and
 *                          Assignment.courseId must be that same course. Assignment.createdBy / courseId alone are not trusted
 *                          (records created before FIX-INS-10 took them from the request).
 *   Assignment editor      (FIX-INS-10) create: ADMIN, or the INSTRUCTOR owning the lesson's course; the course is derived from
 *                          the lesson server-side. update: the INSTRUCTOR owning the course as above, or an ADMIN on an assignment
 *                          they created themselves (the policy before FIX-INS-10 let only the author edit).
 *   Final-project grader   ADMIN, or the INSTRUCTOR who created that final project (FinalProject.createdBy). Being a grader of
 *                          assignments grants nothing here.
 *   Submitter              the learner who owns the submission (its userId), for the learner-facing reads of their own work.
 *
 * A missing object and a forbidden one give the same answer (SubmissionAccessError), so ids outside the caller's scope reveal
 * nothing.
 */
export interface Caller {
  userId: string;
  role?: string;
}

export class SubmissionAccessError extends Error {
  constructor() {
    super('Access forbidden');
    this.name = 'SubmissionAccessError';
  }
}

/** A request that names a lesson / course that does not exist or does not match (400 / 404) - not an authorization verdict. */
export class AssignmentScopeError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'AssignmentScopeError';
  }
}

export class SubmissionAccessService {
  /** INSTRUCTOR owning the course of the assignment's lesson (course-service), with Assignment.courseId = that course. Throws 503. */
  private static async ownsAssignmentCourse(assignment: { courseId: string; lessonId: string }, caller: Caller): Promise<boolean> {
    if (caller.role !== 'INSTRUCTOR') return false;
    const owner = await CourseAccessService.fetchLessonOwner(assignment.lessonId);
    return !!owner && owner.courseId === assignment.courseId && owner.instructorId === caller.userId;
  }

  static async canGradeAssignment(assignment: { courseId: string; lessonId: string } | null | undefined, caller: Caller): Promise<boolean> {
    if (!assignment) return false;
    if (caller.role === 'ADMIN') return true;
    try {
      return await this.ownsAssignmentCourse(assignment, caller);
    } catch (error: any) {
      logger.warn(`Grader check: course lookup failed (${error?.statusCode || error?.message || 'error'})`);
      return false;
    }
  }

  /**
   * FIX-INS-10 - may the caller create the assignment of `lessonId`? Returns the lesson's REAL course (the only courseId ever
   * stored). `claimedCourseId` (from the request) is never used - it must be absent or equal the real one, otherwise 400.
   */
  static async requireAssignmentCreator(lessonId: string, claimedCourseId: unknown, caller: Caller): Promise<{ courseId: string }> {
    if (caller.role !== 'ADMIN' && caller.role !== 'INSTRUCTOR') throw new SubmissionAccessError();
    const owner = await CourseAccessService.fetchLessonOwner(lessonId);
    if (!owner) throw new AssignmentScopeError('Lesson not found', 404);
    if (caller.role === 'INSTRUCTOR' && owner.instructorId !== caller.userId) throw new SubmissionAccessError();
    if (claimedCourseId !== undefined && claimedCourseId !== null && claimedCourseId !== owner.courseId) {
      throw new AssignmentScopeError('courseId does not match the lesson', 400);
    }
    return { courseId: owner.courseId };
  }

  /** FIX-INS-10 - the assignment, when the caller may edit it; unknown and forbidden ids give the same SubmissionAccessError. */
  static async requireAssignmentEditor(assignmentId: string, caller: Caller) {
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new SubmissionAccessError();
    if (caller.role === 'ADMIN') {
      if (assignment.createdBy !== caller.userId) throw new SubmissionAccessError();
      return assignment;
    }
    if (!(await this.ownsAssignmentCourse(assignment, caller))) throw new SubmissionAccessError();
    return assignment;
  }

  static canGradeFinalProject(project: { createdBy: string } | null | undefined, caller: Caller): boolean {
    if (!project) return false;
    if (caller.role === 'ADMIN') return true;
    return caller.role === 'INSTRUCTOR' && project.createdBy === caller.userId;
  }

  /** The assignment, when the caller may list / grade its submissions; otherwise SubmissionAccessError. */
  static async requireAssignmentGrader(assignmentId: string, caller: Caller) {
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!(await this.canGradeAssignment(assignment, caller))) throw new SubmissionAccessError();
    return assignment!;
  }

  static async requireAssignmentSubmissionGrader(submissionId: string, caller: Caller) {
    const submission = await prisma.assignmentSubmission.findUnique({ where: { id: submissionId }, include: { assignment: true } });
    if (!submission || !(await this.canGradeAssignment(submission.assignment, caller))) throw new SubmissionAccessError();
    return submission;
  }

  static async requireFinalProjectGrader(projectId: string, caller: Caller) {
    const project = await prisma.finalProject.findUnique({ where: { id: projectId } });
    if (!this.canGradeFinalProject(project, caller)) throw new SubmissionAccessError();
    return project!;
  }

  /** A final-project submission, for its grader - or also its submitter when `allowSubmitter`. */
  static async requireFinalProjectSubmission(submissionId: string, caller: Caller, allowSubmitter: boolean) {
    const submission = await prisma.finalProjectSubmission.findUnique({ where: { id: submissionId }, include: { finalProject: true } });
    if (!submission) throw new SubmissionAccessError();
    if (allowSubmitter && submission.userId === caller.userId) return submission;
    if (!this.canGradeFinalProject(submission.finalProject, caller)) throw new SubmissionAccessError();
    return submission;
  }
}
