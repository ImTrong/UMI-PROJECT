/**
 * Regression tests: course-access protection for progress + quiz flows.
 * Real service code runs against an in-memory Prisma fake (tests/helpers/fake-prisma.ts)
 * and a stubbed course-service (axios.get). No real database or network is touched.
 *
 * Run: npm test
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePrisma, db } from './helpers/fake-prisma';
import { useRandomCourseLearningToken } from './helpers/internal-token';

installFakePrisma();
// FIX-INS-06: lessons come from the course-service's internal route, which needs the Course <-> Learning credential
const COURSE_LEARNING_TOKEN = useRandomCourseLearningToken();

/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require('axios').default || require('axios');
const logger = require('../src/utils/logger').default;
const { ProgressService } = require('../src/services/progress.service');
const { QuizService } = require('../src/services/quiz.service');
const { CourseAccessError } = require('../src/services/course-access.service');

logger.transports.forEach((t: any) => { t.silent = true; });

// ---------- course-service stub ----------
type CourseStub = { status?: number; networkError?: boolean; course?: any; lessons?: any[] };
const courses = new Map<string, CourseStub>();

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const installAxiosStub = () =>
  mock.method(axios, 'get', async (url: string, config?: any) => {
    // like the real course-service (FIX-INS-06): the internal lessons route answers 403 without COURSE_LEARNING_TOKEN
    if (url.includes('/api/courses/internal/') && config?.headers?.['x-internal-service-token'] !== COURSE_LEARNING_TOKEN) throw httpError(403);
    const m = url.match(/\/api\/courses\/(?:internal\/)?([^/]+?)(\/lessons)?$/);
    const stub = m ? courses.get(m[1]) : undefined;
    if (!stub) throw httpError(404);
    if (stub.networkError) throw new Error('ECONNREFUSED');
    if (stub.status && stub.status >= 400) throw httpError(stub.status);
    if (m![2]) return { data: { data: stub.lessons ?? [] } };
    return { data: { data: stub.course } };
  });

const LESSONS = [
  { id: 'L1', title: 'Lesson 1' },
  { id: 'L2', title: 'Lesson 2' },
];
const defineCourse = (id: string, course: Record<string, any>) =>
  courses.set(id, { course: { id, title: `Course ${id}`, ...course }, lessons: LESSONS });

const PAID = 'paid-course';
const FREE = 'free-course';
const ALICE = 'alice';
const BOB = 'bob';
const OWNER = 'instructor-1';
const OTHER_INSTRUCTOR = 'instructor-2';

const enroll = (userId: string, courseId: string, extra: Record<string, any> = {}) =>
  db.seed('courseProgress', { userId, courseId, courseTitle: courseId, totalLessons: 2, ...extra });

const seedQuiz = (courseId = PAID) =>
  db.seed('quiz', {
    courseId,
    lessonId: 'L1',
    title: 'Quiz',
    createdBy: OWNER,
    passingScore: 70,
    maxAttempts: 3,
    timeLimitMinutes: null,
    questions: [
      {
        id: 'q1', text: '1+1?', type: 'MULTIPLE_CHOICE', points: 10,
        options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], correctAnswerIds: ['b'], explanation: 'math',
      },
    ],
  });

const assertNothingWritten = () => {
  for (const table of ['courseProgress', 'lessonProgress', 'userProgress', 'quizAttempt', 'activityLog']) {
    assert.equal(db.count(table), 0, `${table} must stay empty after a refused request`);
  }
};

const rejects = async (promise: Promise<any>, status: number) => {
  await assert.rejects(promise, (err: any) => {
    assert.ok(err instanceof CourseAccessError, `expected CourseAccessError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.statusCode, status);
    return true;
  });
};

beforeEach(() => {
  db.reset();
  courses.clear();
  defineCourse(PAID, { price: 499000, published: true });
  defineCourse(FREE, { price: 0, published: true });
  installAxiosStub();
});
afterEach(() => mock.restoreAll());

const complete = (userId: string, courseId: string, lessonId = 'L1') =>
  ProgressService.markLessonComplete({ userId, courseId, lessonId, timeSpentSeconds: 30 });

describe('progress: enrollment is required before any write', () => {
  it('ACCESS-01 not enrolled + paid course -> refused, nothing created', async () => {
    await rejects(complete(ALICE, PAID), 403);
    assertNothingWritten();
  });

  it('ACCESS-02 enrolled in paid course -> lesson completed by existing rules', async () => {
    enroll(ALICE, PAID);
    const result = await complete(ALICE, PAID);
    assert.equal(result.isNewCompletion, true);
    assert.equal(result.lessonProgress.completed, true);
    assert.equal(result.courseProgress.completedLessons, 1);
    assert.equal(result.courseProgress.progressPercentage, 50);
    assert.equal(db.count('courseProgress'), 1);
  });

  it('ACCESS-03 verified free course (price === 0, published) -> enrolled through the official flow', async () => {
    const result = await complete(ALICE, FREE);
    assert.equal(result.lessonProgress.completed, true);
    assert.equal(db.count('courseProgress'), 1);
    // official enrollInCourse logs COURSE_ENROLL + bumps the counter
    assert.ok(db.tables.activityLog.some((a) => a.action === 'COURSE_ENROLL'));
    assert.equal(db.tables.userProgress[0].totalCoursesEnrolled, 1);
  });

  for (const [label, price] of [
    ['missing', undefined],
    ['null', null],
    ['string "0"', '0'],
    ['NaN', Number.NaN],
    ['negative', -1],
  ] as const) {
    it(`ACCESS-04 price ${label} -> never treated as free`, async () => {
      defineCourse('odd', { price, published: true });
      await rejects(complete(ALICE, 'odd'), 403);
      await rejects(ProgressService.enrollInCourse(ALICE, 'odd', false), 403);
      assertNothingWritten();
    });
  }

  it('ACCESS-04 course-service unreachable -> no access granted (503)', async () => {
    courses.set('down', { networkError: true });
    await rejects(complete(ALICE, 'down'), 503);
    await rejects(ProgressService.enrollInCourse(ALICE, 'down', false), 503);
    assertNothingWritten();
  });

  it('ACCESS-04 course-service 500 -> no access granted (503)', async () => {
    courses.set('broken', { status: 500 });
    await rejects(complete(ALICE, 'broken'), 503);
    assertNothingWritten();
  });

  it('ACCESS-05 unknown course -> 404, nothing created', async () => {
    await rejects(complete(ALICE, 'does-not-exist'), 404);
    assertNothingWritten();
  });

  it('ACCESS-05 unpublished free course is not enrollable via the public path', async () => {
    defineCourse('draft', { price: 0, published: false });
    await rejects(complete(ALICE, 'draft'), 403);
    await rejects(ProgressService.enrollInCourse(ALICE, 'draft', false), 403);
    assertNothingWritten();
  });

  it('lesson that is not part of the course -> LESSON_NOT_FOUND, nothing created (even for free course)', async () => {
    await assert.rejects(complete(ALICE, FREE, 'foreign-lesson'), /Lesson not found/);
    assertNothingWritten();
  });

  it('paid course: public enroll refused, internal (payment/redeem) enroll still works', async () => {
    await rejects(ProgressService.enrollInCourse(ALICE, PAID, false), 403);
    assertNothingWritten();

    const enrollment = await ProgressService.enrollInCourse(ALICE, PAID, true);
    assert.equal(enrollment.userId, ALICE);
    assert.equal(db.count('courseProgress'), 1);

    // ...and the learner can now learn
    const result = await complete(ALICE, PAID);
    assert.equal(result.lessonProgress.completed, true);
  });

  it('ACCESS-09 concurrent completes while NOT enrolled in a paid course -> all refused, nothing created', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => complete(ALICE, PAID)));
    assert.ok(results.every((r) => r.status === 'rejected'));
    assertNothingWritten();
  });

  it('ACCESS-09 concurrent completes on a free course -> exactly one enrollment, one lesson record, one completion', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => complete(ALICE, FREE)));
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results.map((r: any) => r.reason?.message)));
    assert.equal(db.count('courseProgress'), 1);
    assert.equal(db.count('lessonProgress'), 1);
    const completions = results.filter((r: any) => r.value.isNewCompletion).length;
    assert.equal(completions, 1, 'only one request may be credited with the completion');
    assert.equal(db.tables.activityLog.filter((a) => a.action === 'LESSON_COMPLETE').length, 1);
  });

  it('ACCESS-09 concurrent public + internal enroll -> single CourseProgress', async () => {
    await Promise.allSettled([
      ProgressService.enrollInCourse(ALICE, FREE, false),
      ProgressService.enrollInCourse(ALICE, FREE, true),
      ProgressService.enrollInCourse(ALICE, FREE, false),
    ]);
    assert.equal(db.count('courseProgress'), 1);
  });

  it('ACCESS-10 existing valid progress is preserved and completion is idempotent', async () => {
    // 3-lesson course so this test stays below 100% (course-completion/badge paths are out of scope here)
    courses.get(PAID)!.lessons = [...LESSONS, { id: 'L3', title: 'Lesson 3' }];
    const cp = enroll(ALICE, PAID, { totalLessons: 3, completedLessons: 1, progressPercentage: 33.3, timeSpentSeconds: 120 });
    db.seed('lessonProgress', {
      userId: ALICE, courseId: PAID, lessonId: 'L1', lessonTitle: 'Lesson 1',
      completed: true, completedAt: new Date(), timeSpentSeconds: 120, watchCount: 1,
    });

    const again = await complete(ALICE, PAID, 'L1');
    assert.equal(again.isNewCompletion, false);

    const second = await complete(ALICE, PAID, 'L2');
    assert.equal(second.isNewCompletion, true);

    assert.equal(db.count('courseProgress'), 1);
    assert.equal(db.tables.courseProgress[0].id, cp.id);
    assert.equal(db.tables.courseProgress[0].enrolledAt, cp.enrolledAt);
    assert.equal(db.count('lessonProgress'), 2);
    assert.equal(db.tables.lessonProgress.find((l) => l.lessonId === 'L1')!.watchCount, 1);

    // re-enrolling returns the same record untouched
    const re = await ProgressService.enrollInCourse(ALICE, PAID, true);
    assert.equal(re.id, cp.id);
    assert.equal(db.count('courseProgress'), 1);
  });
});

describe('quiz: every learner endpoint checks enrollment on the server', () => {
  it('ACCESS-06 not enrolled -> start refused, no attempt created', async () => {
    const quiz = seedQuiz();
    await rejects(QuizService.startQuizAttempt(quiz.id, ALICE), 403);
    assert.equal(db.count('quizAttempt'), 0);
  });

  it('ACCESS-06 free course learner who never enrolled is NOT auto-enrolled by the quiz API', async () => {
    const quiz = seedQuiz(FREE);
    await rejects(QuizService.startQuizAttempt(quiz.id, ALICE), 403);
    assertNothingWritten();
  });

  it('ACCESS-07 not enrolled -> direct submit refused, attempt untouched', async () => {
    const quiz = seedQuiz();
    const attempt = db.seed('quizAttempt', { quizId: quiz.id, userId: ALICE, courseId: PAID, answers: [], totalQuestions: 1 });
    await rejects(
      QuizService.submitQuiz(attempt.id, ALICE, [{ questionId: 'q1', selectedOptionIds: ['b'] }]),
      403
    );
    assert.equal(attempt.status, 'IN_PROGRESS');
    assert.equal(attempt.score, 0);
    assert.equal(db.count('courseProgress'), 0);
  });

  it('ACCESS-07 not enrolled -> cannot read quiz, nor attempt history', async () => {
    const quiz = seedQuiz();
    await rejects(QuizService.getQuizByLessonId('L1', { userId: ALICE, role: 'STUDENT' }), 403);
    await rejects(QuizService.getUserAttempts(quiz.id, ALICE), 403);
  });

  it('ACCESS-08 another user\'s attempt id cannot be submitted or altered', async () => {
    const quiz = seedQuiz();
    enroll(ALICE, PAID);
    enroll(BOB, PAID);
    const aliceAttempt = await QuizService.startQuizAttempt(quiz.id, ALICE);

    await assert.rejects(
      QuizService.submitQuiz(aliceAttempt.id, BOB, [{ questionId: 'q1', selectedOptionIds: ['b'] }]),
      /Quiz attempt not found/
    );
    const stored = db.tables.quizAttempt.find((a) => a.id === aliceAttempt.id)!;
    assert.equal(stored.status, 'IN_PROGRESS');
    assert.deepEqual(stored.answers, []);

    // Bob only ever sees his own history
    assert.deepEqual(await QuizService.getUserAttempts(quiz.id, BOB), []);
    assert.equal((await QuizService.getUserAttempts(quiz.id, ALICE)).length, 1);
  });

  it('enrolled learner: start -> submit is graded on the server and works as before', async () => {
    const quiz = seedQuiz();
    enroll(ALICE, PAID);
    const attempt = await QuizService.startQuizAttempt(quiz.id, ALICE);
    assert.equal(attempt.status, 'IN_PROGRESS');

    // repeated start returns the same in-progress attempt
    const again = await QuizService.startQuizAttempt(quiz.id, ALICE);
    assert.equal(again.id, attempt.id);

    // a forged score/passed in the payload is ignored: only selected options matter
    const wrong = await QuizService.submitQuiz(attempt.id, ALICE, [
      { questionId: 'q1', selectedOptionIds: ['a'], score: 100, passed: true } as any,
    ]);
    assert.equal(wrong.results.score, 0);
    assert.equal(wrong.results.passed, false);
    assert.equal(wrong.attempt.status, 'SUBMITTED');

    // second attempt (retry policy unchanged) gets full marks
    const retry = await QuizService.startQuizAttempt(quiz.id, ALICE);
    assert.notEqual(retry.id, attempt.id);
    const right = await QuizService.submitQuiz(retry.id, ALICE, [{ questionId: 'q1', selectedOptionIds: ['b'] }]);
    assert.equal(right.results.score, 100);
    assert.equal(right.results.passed, true);
  });

  it('ACCESS-09 same attempt submitted concurrently -> exactly one wins, no double grading', async () => {
    const quiz = seedQuiz();
    enroll(ALICE, PAID);
    const attempt = await QuizService.startQuizAttempt(quiz.id, ALICE);
    const answers = [{ questionId: 'q1', selectedOptionIds: ['b'] }];

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => QuizService.submitQuiz(attempt.id, ALICE, answers))
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(db.tables.quizAttempt.filter((a) => a.status === 'SUBMITTED').length, 1);
  });

  it('ACCESS-09 concurrent start for an enrolled learner converges on one in-progress attempt', async () => {
    const quiz = seedQuiz();
    enroll(ALICE, PAID);
    const attempts = await Promise.all(Array.from({ length: 4 }, () => QuizService.startQuizAttempt(quiz.id, ALICE)));
    assert.ok(attempts.every((a) => a.id === attempts[0].id), 'all callers must receive the same attempt');
    assert.equal(db.count('quizAttempt'), 1);
  });

  it('answer keys are never exposed to learners, and only the author/admin sees them', async () => {
    seedQuiz();
    enroll(ALICE, PAID);

    const asLearner = await QuizService.getQuizByLessonId('L1', { userId: ALICE, role: 'STUDENT' });
    assert.ok(asLearner.questions.every((q: any) => !('correctAnswerIds' in q) && !('explanation' in q)));

    // an INSTRUCTOR who is not the author gets learner treatment (needs enrollment, no answers)
    await rejects(QuizService.getQuizByLessonId('L1', { userId: OTHER_INSTRUCTOR, role: 'INSTRUCTOR' }), 403);

    const asAuthor = await QuizService.getQuizByLessonId('L1', { userId: OWNER, role: 'INSTRUCTOR' });
    assert.deepEqual(asAuthor.questions[0].correctAnswerIds, ['b']);
    const asAdmin = await QuizService.getQuizByLessonId('L1', { userId: 'admin-1', role: 'ADMIN' });
    assert.deepEqual(asAdmin.questions[0].correctAnswerIds, ['b']);
  });

  it('all-learner attempt listing is limited to the author/admin', async () => {
    const quiz = seedQuiz();
    await assert.rejects(
      QuizService.getAllAttempts(quiz.id, { userId: OTHER_INSTRUCTOR, role: 'INSTRUCTOR' }),
      /Access forbidden/
    );
    await assert.rejects(
      QuizService.getAllAttempts(quiz.id, { userId: ALICE, role: 'STUDENT' }),
      /Access forbidden/
    );
    const ok = await QuizService.getAllAttempts(quiz.id, { userId: OWNER, role: 'INSTRUCTOR' });
    assert.equal(ok.pagination.total, 0);
  });

  it('createQuiz refuses to bind a quiz to a lesson that is not in the given course', async () => {
    await assert.rejects(
      QuizService.createQuiz({
        courseId: PAID, lessonId: 'lesson-of-another-course', title: 't', questions: [], createdBy: OWNER,
      }),
      /does not belong/
    );
    assert.equal(db.count('quiz'), 0);

    courses.set('down', { networkError: true });
    await rejects(
      QuizService.createQuiz({ courseId: 'down', lessonId: 'L1', title: 't', questions: [], createdBy: OWNER }),
      503
    );

    const created = await QuizService.createQuiz({
      courseId: PAID, lessonId: 'L1', title: 't', questions: [], createdBy: OWNER,
    });
    assert.equal(created.courseId, PAID);
  });
});
