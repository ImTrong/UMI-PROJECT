import { PrismaClient } from '@prisma/client';
import { SubmissionAccessService } from './submission-access.service';

const prisma = new PrismaClient();

/**
 * FIX-INS-08 - who may download a file through GET /api/learning/files/download.
 *
 * The bucket / key (and any userId, submissionId, courseId...) in the request prove nothing. A file is served only when THIS
 * service's records reference exactly that bucket + key, and the signed-in caller may read EVERY record that references it (the
 * most restrictive reference wins - a submission that copies someone else's key cannot open that file to its author, nor to
 * anyone else).
 *
 *   bucket `assignments`
 *     AssignmentSubmission.fileKey / fileUrl      the submitter; the assignment's grader (the owner of the course that contains
 *                                                 its lesson - FIX-INS-09, SubmissionAccessService); ADMIN
 *     FinalProjectSubmission.fileKey / fileUrl /  the submitter; the final project's grader (its INSTRUCTOR author); ADMIN
 *       submissionData[].fileKey | value          (the final project of a learning path is managed by its author / an ADMIN)
 *   bucket `quiz-attachments`
 *     no record references it today (no route uploads to it, quiz questions have no file field): every request is refused until
 *     a flow with its own access rule exists
 *   any other bucket                              refused (served by other, authorised paths or not at all)
 * Nothing matches by substring alone: a candidate found by the database is re-checked for the exact bucket + key.
 */
export const LEARNING_DOWNLOAD_BUCKETS = ['assignments', 'quiz-attachments'] as const;
const KEY_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export type LearningFileReference =
  | { kind: 'ASSIGNMENT_SUBMISSION'; submissionId: string; ownerId: string; assignmentId: string; courseId: string }
  | { kind: 'FINAL_PROJECT_SUBMISSION'; submissionId: string; ownerId: string; finalProjectId: string };

export interface FileRequester {
  userId: string;
  role?: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** bucket + key of a stored learning download URL, or null when the value is not one. */
export function parseLearningDownloadRef(value: unknown): { bucket: string; key: string } | null {
  if (typeof value !== 'string' || !value.includes('/api/learning/files/download')) return null;
  const q = value.split('?')[1];
  if (!q) return null;
  const params = new URLSearchParams(q);
  const bucket = params.get('bucket');
  const key = params.get('key');
  return bucket && key ? { bucket, key } : null;
}

const urlRefersTo = (value: unknown, bucket: string, key: string) => {
  const ref = parseLearningDownloadRef(value);
  return !!ref && ref.bucket === bucket && ref.key === key;
};

const oid = (v: any) => String(v?.$oid ?? v);

export class LearningFileAccessService {
  static isValidRequest(bucket: unknown, key: unknown): boolean {
    return typeof bucket === 'string' && (LEARNING_DOWNLOAD_BUCKETS as readonly string[]).includes(bucket)
      && typeof key === 'string' && KEY_FORMAT.test(key) && !key.includes('..');
  }

  static async findReferences(bucket: string, key: string): Promise<LearningFileReference[]> {
    if (bucket !== 'assignments') return []; // quiz-attachments: no record type references it (see above)
    const refs: LearningFileReference[] = [];

    const assignmentSubs = await prisma.assignmentSubmission.findMany({
      where: { OR: [{ fileKey: key }, { fileUrl: { contains: key } }] },
      select: { id: true, userId: true, assignmentId: true, courseId: true, fileKey: true, fileUrl: true },
    });
    for (const s of assignmentSubs) {
      if (s.fileKey === key || urlRefersTo(s.fileUrl, bucket, key)) {
        refs.push({ kind: 'ASSIGNMENT_SUBMISSION', submissionId: s.id, ownerId: s.userId, assignmentId: s.assignmentId, courseId: s.courseId });
      }
    }

    const projectSubs = await prisma.finalProjectSubmission.findMany({
      where: { OR: [{ fileKey: key }, { fileUrl: { contains: key } }] },
      select: { id: true, userId: true, finalProjectId: true, fileKey: true, fileUrl: true },
    });
    for (const s of projectSubs) {
      if (s.fileKey === key || urlRefersTo(s.fileUrl, bucket, key)) {
        refs.push({ kind: 'FINAL_PROJECT_SUBMISSION', submissionId: s.id, ownerId: s.userId, finalProjectId: s.finalProjectId });
      }
    }

    // multi-part submissions keep their files in the submissionData JSON list ({ fileKey?, value? })
    const raw = (await prisma.finalProjectSubmission.findRaw({
      filter: { $or: [{ 'submissionData.fileKey': key }, { 'submissionData.value': { $regex: `key=${escapeRegex(key)}(&|$)` } }] },
      options: { projection: { _id: 1, userId: 1, finalProjectId: 1, submissionData: 1 } },
    })) as unknown as any[];
    for (const doc of Array.isArray(raw) ? raw : []) {
      const items = Array.isArray(doc.submissionData) ? doc.submissionData : [];
      if (!items.some((i: any) => i && (i.fileKey === key || urlRefersTo(i.value, bucket, key)))) continue;
      const submissionId = oid(doc._id);
      if (refs.some((r) => r.kind === 'FINAL_PROJECT_SUBMISSION' && r.submissionId === submissionId)) continue;
      refs.push({ kind: 'FINAL_PROJECT_SUBMISSION', submissionId, ownerId: oid(doc.userId), finalProjectId: oid(doc.finalProjectId) });
    }
    return refs;
  }

  /** true only when the caller may read the file under EVERY record that references it. */
  static async canDownload(bucket: string, key: string, requester: FileRequester): Promise<boolean> {
    const refs = await this.findReferences(bucket, key);
    if (refs.length === 0) return false;
    if (requester.role === 'ADMIN') return true;

    for (const ref of refs) {
      if (ref.ownerId === requester.userId) continue;
      // FIX-INS-09: the same grader rules as the submission APIs (SubmissionAccessService)
      if (ref.kind === 'ASSIGNMENT_SUBMISSION') {
        const assignment = await prisma.assignment.findUnique({ where: { id: ref.assignmentId }, select: { courseId: true, lessonId: true } });
        if (!(await SubmissionAccessService.canGradeAssignment(assignment, requester))) return false;
      } else {
        const project = await prisma.finalProject.findUnique({ where: { id: ref.finalProjectId }, select: { createdBy: true } });
        if (!SubmissionAccessService.canGradeFinalProject(project, requester)) return false;
      }
    }
    return true;
  }
}
