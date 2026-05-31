import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface TaskItem {
  id: string;
  type: 'QUIZ' | 'ASSIGNMENT';
  title: string;
  courseId: string;
  lessonId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'LATE';
  score?: number;
  dueDate?: Date | null;
  maxScore?: number;
  passingScore?: number;
}

export class TaskService {
  static async getCourseTasks(courseId: string) {
    const quizzes = await prisma.quiz.findMany({
      where: { courseId },
      select: { lessonId: true }
    });

    const assignments = await prisma.assignment.findMany({
      where: { courseId },
      select: { lessonId: true }
    });

    const taskMap: Record<string, Array<'QUIZ' | 'ASSIGNMENT'>> = {};
    quizzes.forEach(q => {
      if (!taskMap[q.lessonId]) taskMap[q.lessonId] = [];
      taskMap[q.lessonId].push('QUIZ');
    });
    assignments.forEach(a => {
      if (!taskMap[a.lessonId]) taskMap[a.lessonId] = [];
      if (!taskMap[a.lessonId].includes('ASSIGNMENT')) {
         taskMap[a.lessonId].push('ASSIGNMENT');
      }
    });

    return taskMap;
  }

  static async getUserTasks(userId: string) {
    // 1. Get enrolled courses
    const courseProgress = await prisma.courseProgress.findMany({
      where: { userId },
      select: { courseId: true, courseTitle: true }
    });

    // We don't return early if empty because they might have created quizzes (as an instructor testing)
    
    const courseIds = courseProgress.map(cp => cp.courseId);
    const courseTitleMap = new Map(courseProgress.map(cp => [cp.courseId, cp.courseTitle]));

    // 2. Fetch Quizzes (Enrolled OR Created By User)
    const quizzes = await prisma.quiz.findMany({
      where: { 
        OR: [
          { courseId: { in: courseIds } },
          { createdBy: userId }
        ]
      },
      include: {
        attempts: {
          where: { userId }
        }
      }
    });

    // 3. Fetch Assignments (Enrolled OR Created By User)
    const assignments = await prisma.assignment.findMany({
      where: { 
        OR: [
          { courseId: { in: courseIds } },
          { createdBy: userId }
        ]
      },
      include: {
        submissions: {
          where: { userId }
        }
      }
    });

    const tasks: TaskItem[] = [];

    // 4. Map Quizzes
    for (const quiz of quizzes) {
      const attempts = quiz.attempts;
      const passedAttempt = attempts.find(a => a.passed);
      const isCompleted = !!passedAttempt;
      let status: TaskItem['status'] = 'NOT_STARTED';

      if (isCompleted) {
        status = 'COMPLETED';
      } else if (attempts.length > 0) {
        status = 'IN_PROGRESS';
      }

      tasks.push({
        id: quiz.id,
        type: 'QUIZ',
        title: quiz.title,
        courseId: quiz.courseId,
        lessonId: quiz.lessonId,
        status,
        score: passedAttempt?.score || (attempts.length > 0 ? attempts[0].score : undefined),
        passingScore: quiz.passingScore
      });
    }

    // 5. Map Assignments
    for (const assignment of assignments) {
      const submissions = assignment.submissions;
      const latestSub = submissions.length > 0 ? submissions[0] : null;
      let status: TaskItem['status'] = 'NOT_STARTED';

      if (latestSub) {
        if (latestSub.status === 'GRADED') status = 'COMPLETED';
        else status = 'IN_PROGRESS';
      } else if (assignment.dueDate && new Date() > new Date(assignment.dueDate)) {
        status = 'LATE';
      }

      tasks.push({
        id: assignment.id,
        type: 'ASSIGNMENT',
        title: assignment.title,
        courseId: assignment.courseId,
        lessonId: assignment.lessonId,
        status,
        dueDate: assignment.dueDate,
        maxScore: assignment.maxScore,
        score: latestSub?.score || undefined
      });
    }

    // Sort: NOT_STARTED > IN_PROGRESS > LATE > COMPLETED
    const statusOrder: Record<string, number> = {
      'LATE': 0,
      'NOT_STARTED': 1,
      'IN_PROGRESS': 2,
      'COMPLETED': 3
    };

    tasks.sort((a, b) => {
      if (statusOrder[a.status] !== statusOrder[b.status]) {
         return statusOrder[a.status] - statusOrder[b.status];
      }
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      return 0;
    });

    return tasks.map(t => ({
      ...t,
      courseTitle: courseTitleMap.get(t.courseId) || 'Khóa học của bạn'
    }));
  }

  /**
   * Get detailed info for a single task (quiz or assignment) by its ID
   */
  static async getTaskDetail(taskId: string, type: 'QUIZ' | 'ASSIGNMENT') {
    if (type === 'QUIZ') {
      const quiz = await prisma.quiz.findUnique({
        where: { id: taskId },
      });
      if (!quiz) throw new Error('Quiz not found');

      // Try to get course title from CourseProgress
      const courseTitle = await prisma.courseProgress.findFirst({
        where: { courseId: quiz.courseId },
        select: { courseTitle: true },
      }).then(cp => cp?.courseTitle || 'Khóa học');

      return {
        id: quiz.id,
        type: 'QUIZ' as const,
        title: quiz.title,
        description: quiz.description,
        courseId: quiz.courseId,
        lessonId: quiz.lessonId,
        courseTitle,
        passingScore: quiz.passingScore,
        timeLimitMinutes: quiz.timeLimitMinutes,
        maxAttempts: quiz.maxAttempts,
      };
    } else {
      const assignment = await prisma.assignment.findUnique({
        where: { id: taskId },
      });
      if (!assignment) throw new Error('Assignment not found');

      const courseTitle = await prisma.courseProgress.findFirst({
        where: { courseId: assignment.courseId },
        select: { courseTitle: true },
      }).then(cp => cp?.courseTitle || 'Khóa học');

      return {
        id: assignment.id,
        type: 'ASSIGNMENT' as const,
        title: assignment.title,
        description: assignment.description,
        instructions: assignment.instructions,
        courseId: assignment.courseId,
        lessonId: assignment.lessonId,
        courseTitle,
        dueDate: assignment.dueDate,
        maxScore: assignment.maxScore,
        allowLateSubmission: assignment.allowLateSubmission,
        allowedFileTypes: assignment.allowedFileTypes,
        maxFileSizeMB: assignment.maxFileSizeMB,
      };
    }
  }
}
