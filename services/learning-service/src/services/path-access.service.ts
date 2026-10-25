import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * FIX-INS-12 - who may see / join a learning path, by its status. Learner routes only; ADMIN manages every status through the
 * protected /api/learning/admin/paths* API (FIX-INS-11).
 *
 *   PUBLISHED   every signed-in user may read it and enroll.
 *   ARCHIVED    no new enrollment; a learner who was ALREADY enrolled (UserPathEnrollment row, looked up for the authenticated
 *               user) keeps reading it and keeps working on its final project.
 *   DRAFT / any other value   not visible to learners at all - also not to someone enrolled before it went back to draft.
 *
 * The status always comes from the stored path and the enrollment from the database; nothing from the request counts. A path the
 * caller may not see answers exactly like a missing one.
 */
export const PATH_NOT_FOUND = 'Learning path not found';

type PathLike = { id: string; status?: string | null } | null | undefined;

export class PathAccessService {
  /** May a learner start a NEW enrollment on this path? */
  static canEnrollNew(path: PathLike): boolean {
    return !!path && path.status === 'PUBLISHED';
  }

  /** Is the path listed among a learner's own enrollments (my paths, home / recommendation widgets)? */
  static isVisibleToEnrolled(path: PathLike): boolean {
    return !!path && (path.status === 'PUBLISHED' || path.status === 'ARCHIVED');
  }

  /** May this learner read the path (detail, its final project, unlock status)? */
  static async canView(path: PathLike, userId?: string): Promise<boolean> {
    if (!path) return false;
    if (path.status === 'PUBLISHED') return true;
    if (path.status !== 'ARCHIVED' || !userId) return false;
    const enrollment = await prisma.userPathEnrollment.findUnique({
      where: { userId_learningPathId: { userId, learningPathId: path.id } },
    });
    return !!enrollment;
  }

  /** The path, when the learner may read it; otherwise Error(PATH_NOT_FOUND) - same as a missing path. */
  static async requireViewable(pathId: string, userId?: string) {
    const path = await prisma.learningPath.findUnique({ where: { id: pathId } });
    if (!(await this.canView(path, userId))) throw new Error(PATH_NOT_FOUND);
    return path!;
  }
}
