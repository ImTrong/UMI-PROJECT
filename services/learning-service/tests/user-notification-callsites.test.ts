/**
 * FIX 06C-4B2A: all 11 places that ask the User Service for a notification now go through the shared client.
 *
 * Part 1 - STATIC census of src/: exactly 11 call sites in the 7 expected files, no other code knows the endpoint or the token header,
 *          no call sits inside a database transaction callback, no secret is hardcoded, the payload keeps its five fields.
 * Part 2 - BEHAVIOUR of every call site that is not covered by its own suite (leaderboard: tests/leaderboard-finalize.test.ts,
 *          redemption: tests/redemption-transactions.test.ts): the real service function runs on a loose in-memory Prisma
 *          stand-in, axios.post is a recorder, and for each site we check
 *            ok .......... one request, the internal token header and nothing else, the exact payload, no transaction open,
 *                          the business effect happened;
 *            HTTP 500 / 403 / timeout ... the flow still completes, ONE request (no retry was added), the failure is logged and the
 *                          log never contains the secret;
 *            no token .... no request at all, the flow still completes, the log says why.
 *
 * No token literal lives in this file (random per run); nothing leaves the process.
 *
 * Run: npm test
 */
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { installLoosePrisma, loose } from './helpers/loose-prisma';
import { useRandomInternalToken } from './helpers/internal-token';

installLoosePrisma();
useRandomInternalToken();

/* eslint-disable @typescript-eslint/no-var-requires */
const ts = require('typescript');

const SRC = path.join(__dirname, '..', 'src');
const listTs = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'node_modules' || e.name === 'dist' ? [] : listTs(path.join(dir, e.name))) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  );
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

// ================================================================================================
// Part 1: static census
// ================================================================================================
describe('CALLSITES (static): who may talk to POST /api/users/internal/notifications', () => {
  const CLIENT = 'services/user-notification.client.ts';
  const EXPECTED: Record<string, number> = {
    'jobs/study-reminder.job.ts': 1,
    'services/badge.service.ts': 1,
    'services/course-redemption.service.ts': 1,
    'services/final-project.service.ts': 3,
    'services/leaderboard.service.ts': 1,
    'services/path.service.ts': 2,
    'services/progress.service.ts': 2,
  };
  const TX_CALLEE = /(?:^|\.)(?:\$transaction|transaction|runTx|withTx|fencedTx|fencedTransition|persistEntryRewards)$/;

  interface Site { file: string; line: number; keys: string[]; optionKeys: string[] | null; insideTransaction: string | null }
  const sites: Site[] = [];
  const files = listTs(SRC);

  before(() => {
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('UserNotificationClient')) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true);
      const walk = (node: any) => {
        if (ts.isCallExpression(node) && node.expression.getText(sf) === 'UserNotificationClient.send') {
          const names = (obj: any) => (ts.isObjectLiteralExpression(obj) ? obj.properties.map((p: any) => p.name.getText(sf)).sort() : null);
          let insideTransaction: string | null = null;
          for (let p = node.parent; p; p = p.parent) {
            if (ts.isCallExpression(p) && TX_CALLEE.test(p.expression.getText(sf))) { insideTransaction = p.expression.getText(sf); break; }
          }
          sites.push({
            file: rel(file),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            keys: names(node.arguments[0]) ?? ['<not an object literal>'],
            optionKeys: node.arguments[1] ? names(node.arguments[1]) : null,
            insideTransaction,
          });
        }
        ts.forEachChild(node, walk);
      };
      walk(sf);
    }
  });

  it('exactly 11 call sites, in exactly the 7 expected files, all through UserNotificationClient.send', () => {
    const perFile: Record<string, number> = {};
    for (const s of sites) perFile[s.file] = (perFile[s.file] || 0) + 1;
    assert.deepEqual(perFile, EXPECTED);
    assert.equal(sites.length, 11);
  });

  it('nothing but the client knows the endpoint path', () => {
    const offenders = files.filter((f) => rel(f) !== CLIENT && /internal\/notifications/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    assert.deepEqual(offenders, []);
  });

  it('the token header is written only by the three places that speak the internal-service contract', () => {
    const users = files.filter((f) => /x-internal-service-token/i.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    assert.deepEqual(users, [
      CLIENT, 'middleware/internal-auth.middleware.ts', 'services/user-eligibility.service.ts',
      // FIX-INS-03: the RECEIVING side of the Course -> Learning credential (checks the header, never sends it to the user-service)
      'middleware/service-token.middleware.ts', 'utils/service-token.ts',
      // RAG-SEC-LOG-01: the log redaction names the header only to MASK its value in log lines (never sends it; the
      // senders assertion below is unchanged)
      'utils/log-redaction.ts',
    ].sort());
    // only these put a service token on an outgoing request: the two user-service senders, and (FIX-INS-04) the order-service
    // entitlement check, which sends ORDER_LEARNING_TOKEN to the ORDER-service - never to /api/users/internal/notifications
    const senders = files.filter((f) => /headers:\s*\{[^}]*(x-internal-service-token|\[INTERNAL_TOKEN_HEADER\]|\[SERVICE_TOKEN_HEADER\])/i.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    assert.deepEqual(senders, [CLIENT, 'services/user-eligibility.service.ts', 'services/order-entitlement.client.ts'].sort());
  });

  it('no call sits inside a transaction callback (a notification is a network call)', () => {
    assert.deepEqual(sites.filter((s) => s.insideTransaction).map((s) => `${s.file}:${s.line} inside ${s.insideTransaction}`), []);
  });

  it('every payload is an object literal with exactly the five fields the User Service reads; only the leaderboard passes options: its timeout and its idempotency key', () => {
    for (const s of sites) assert.deepEqual(s.keys, ['link', 'message', 'title', 'type', 'userId'], `${s.file}:${s.line}`);
    const withOptions = sites.filter((s) => s.optionKeys);
    assert.deepEqual(withOptions.map((s) => [s.file, s.optionKeys]), [['services/leaderboard.service.ts', ['idempotencyKey', 'timeoutMs']]]);
    // KN-06: the leaderboard key never leaks into another kind of notification
    const others = files.filter((f) => rel(f) !== 'services/leaderboard.service.ts' && rel(f) !== 'services/leaderboard-notification.ts' && /rewardNotificationKey|reward_lb_notify_/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    assert.deepEqual(others, [], 'no other code builds or sends the leaderboard notification key');
  });

  it('no secret is hardcoded anywhere in src, and the client has no fallback token', () => {
    const offenders = files.filter((f) => /internal_secret_token_umi/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    assert.deepEqual(offenders, [], 'the default token of docker-compose is not baked into any source file');
    const client = fs.readFileSync(path.join(SRC, CLIENT), 'utf8');
    assert.ok(!/INTERNAL_SERVICE_TOKEN\s*(\|\||\?\?)/.test(client), 'no `|| default` on the token');
    assert.equal((client.match(/process\.env\.INTERNAL_SERVICE_TOKEN/g) || []).length, 1, 'the token comes from the environment, in one place');
    assert.ok(!/(?:token|secret|password)\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i.test(client.replace(/\/\*[\s\S]*?\*\//g, '')), 'no token-looking literal');
  });
});

// ================================================================================================
// Part 2: behaviour of every call site (loose Prisma, recorded axios)
// ================================================================================================
const axios = require('axios').default || require('axios');
const logger = require('../src/utils/logger').default;
logger.transports.forEach((t: any) => { t.silent = true; });

const USER = 'a1'.repeat(12);
const COURSE = 'c1'.repeat(12);
const PATH = 'f1'.repeat(12);
const ADMIN = 'ad'.repeat(12);
const HEADER = 'x-internal-service-token';

type Mode = 'ok' | 'http500' | 'http403' | 'timeout';
let mode: Mode = 'ok';
let sent: Array<{ url: string; body: any; config: any; openTx: number }> = [];
let logged: any[][] = [];
let currentToken = '';

/** An error shaped like a real AxiosError: it carries the whole request config - the secret included. */
const axiosLike = (message: string, over: Record<string, unknown>, config: any) =>
  Object.assign(new Error(message), { isAxiosError: true, config: { headers: { ...(config?.headers ?? {}) } }, request: { headers: { ...(config?.headers ?? {}) } }, ...over });

const logText = () => util.inspect(logged.filter((l) => l[0] === 'error' || l[0] === 'warn'), { depth: 10, showHidden: true });

interface Site {
  id: string;
  drive: () => Promise<unknown>;
  expected: { userId: string; title: string; message: string; type: string; link: string };
  effect: () => boolean;
}
let SITES: Site[] = [];
let scheduled: (() => Promise<void>) | null = null;

describe('CALLSITES (behaviour): the other 9 call sites run through the shared client', () => {
  let BadgeService: any, BadgeType: any, ProgressService: any, PathService: any, FinalProjectService: any;
  let AchievementService: any, LearnerAnalysisService: any, EvaluationEngineService: any;

  before(() => {
    // collaborators that are not under test and would do real work
    const cert = require.resolve('../src/services/certificate.service');
    require.cache[cert] = { id: cert, filename: cert, loaded: true, exports: { CertificateService: { generatePathCertificate: async () => undefined } } } as any;
    const cron = require.resolve('node-cron');
    require.cache[cron] = { id: cron, filename: cron, loaded: true, exports: { schedule: (_expr: string, cb: () => Promise<void>) => { scheduled = cb; return {}; } } } as any;

    ({ BadgeService } = require('../src/services/badge.service'));
    ({ BadgeType } = require('../src/types'));
    ({ ProgressService } = require('../src/services/progress.service'));
    ({ PathService } = require('../src/services/path.service'));
    ({ FinalProjectService } = require('../src/services/final-project.service'));
    ({ AchievementService } = require('../src/services/achievement.service'));
    ({ LearnerAnalysisService } = require('../src/services/learner-analysis.service'));
    ({ EvaluationEngineService } = require('../src/services/evaluation-engine.service'));
    const { startStudyReminderJob } = require('../src/jobs/study-reminder.job');

    const { BADGE_CONFIG } = require('../src/types');
    const badge = BADGE_CONFIG[BadgeType.COURSE_COMPLETER];
    const finished = (extra: Record<string, unknown>) => ({ id: 'sub', userId: USER, learningPathId: PATH, ...extra });
    const sequence = (...values: any[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
    const enrollmentOf = () => ({ id: 'enr1', learningPath: { id: PATH, title: 'Lộ trình A', courseIds: [COURSE] } });
    const pathDone = { userId: USER, title: '🎉 Lộ trình hoàn thành!', message: 'Chúc mừng bạn đã hoàn thành lộ trình "Lộ trình A". Chứng chỉ lộ trình của bạn đã được tạo!', type: 'SUCCESS', link: '/certificates' };
    const reverted = () => loose.calls.some((c) => c.model === 'finalProjectSubmission' && c.op === 'update' && c.args?.data?.status === 'SUBMITTED');
    const graded = () => loose.calls.some((c) => c.model === 'finalProjectSubmission' && c.op === 'update' && c.args?.data?.status === 'GRADED');
    const progressCase = (passed: boolean) => () => {
      loose.on('courseProgress.findUnique', sequence(
        { userId: USER, courseId: COURSE, progressPercentage: 100, completedAt: null, timeSpentSeconds: 600, passingScore: 80 },
        { userId: USER, courseId: COURSE, passed, completedAt: new Date('2026-10-01T00:00:00Z'), averageQuizScore: passed ? 92.5 : 55.5 }
      ));
      return ProgressService.checkAndCompleteCourse(USER, COURSE, 'Khóa A');
    };

    SITES = [
      {
        id: 'badge.service.ts:50 awardBadge',
        drive: () => BadgeService.awardBadge(USER, BadgeType.COURSE_COMPLETER, {}),
        expected: { userId: USER, title: '🎖️ Bạn đã nhận được Huy chương mới!', message: `Chúc mừng bạn đã đạt Huy chương "${badge.name}": ${badge.description}`, type: 'SUCCESS', link: '/badges' },
        effect: () => loose.count('badge', 'create') === 1,
      },
      {
        id: 'progress.service.ts:463 checkAndCompleteCourse (passed)',
        drive: progressCase(true),
        expected: { userId: USER, title: '🎉 Khóa học hoàn thành!', message: 'Chúc mừng bạn đã hoàn thành xuất sắc khóa học "Khóa A" với điểm 92.5%. Bạn có thể nhận chứng nhận ngay!', type: 'SUCCESS', link: `/course-exam/${COURSE}` },
        effect: () => loose.count('courseProgress', 'update') >= 1,
      },
      {
        id: 'progress.service.ts:471 checkAndCompleteCourse (not passed)',
        drive: progressCase(false),
        expected: { userId: USER, title: '📝 Khóa học hoàn thành - Chưa đạt điểm', message: 'Bạn đã hoàn thành khóa học "Khóa A" nhưng điểm trung bình quiz (55.5%) chưa đạt ngưỡng. Bạn có thể học lại miễn phí!', type: 'WARNING', link: `/course-exam/${COURSE}` },
        effect: () => loose.count('courseProgress', 'update') >= 1,
      },
      {
        id: 'path.service.ts:351 enrollInPath',
        drive: () => {
          // FIX-INS-12: only a PUBLISHED path takes new enrollments
          loose.on('learningPath.findUnique', { id: PATH, title: 'Lộ trình A', courseIds: [COURSE], status: 'PUBLISHED' });
          loose.on('courseProgress.findMany', [{ progressPercentage: 100 }]);
          return PathService.enrollInPath(USER, PATH);
        },
        expected: pathDone,
        effect: () => loose.count('userPathEnrollment', 'create') === 1,
      },
      {
        id: 'path.service.ts:439 updatePathProgress',
        drive: () => {
          loose.on('userPathEnrollment.findMany', [enrollmentOf()]);
          loose.on('courseProgress.findMany', [{ progressPercentage: 100 }]);
          return PathService.updatePathProgress(USER, COURSE);
        },
        expected: pathDone,
        effect: () => loose.count('userPathEnrollment', 'update') === 1,
      },
      {
        id: 'final-project.service.ts:929 gradeSubmission',
        drive: () => {
          loose.on('finalProjectSubmission.findUnique', finished({ finalProject: { title: 'Dự án X', passingScore: 70 } }));
          return FinalProjectService.gradeSubmission('sub', ADMIN, { score: 90, feedback: 'tốt' });
        },
        expected: { userId: USER, title: '🎉 Project cuối kỳ đạt điểm!', message: 'Chúc mừng! Project "Dự án X" đạt 90%. Bạn đủ điều kiện nhận chứng chỉ lộ trình!', type: 'SUCCESS', link: '/learning-paths' },
        effect: () => loose.count('finalProjectSubmission', 'update') === 1,
      },
      {
        id: 'final-project.service.ts:837 evaluateSubmission (AI evaluation, no project context)',
        drive: () => {
          loose.on('finalProjectSubmission.findUnique', finished({
            processingStatus: 'UPLOADED', projectContext: null, submissionData: [], content: 'Bài làm', attemptNumber: 1,
            finalProject: { title: 'Dự án Y', description: 'd', passingScore: 70, evaluationPipeline: [{ id: 1 }] },
          }));
          return FinalProjectService.evaluateSubmission('sub', 'Bearer caller-token');
        },
        expected: { userId: USER, title: '🎉 Bài kiểm tra cuối kỳ ĐẠT!', message: 'Chúc mừng! Bài kiểm tra "Dự án Y" đạt 80%. Bạn đủ điều kiện nhận chứng chỉ lộ trình!', type: 'SUCCESS', link: `/final-project/${PATH}` },
        effect: () => graded() && !reverted(),
      },
      {
        id: 'final-project.service.ts:668 evaluateSubmission (evaluation engine, with project context)',
        drive: () => {
          loose.on('finalProjectSubmission.findUnique', finished({
            processingStatus: 'READY_FOR_EVALUATION', projectContext: { metadata: {} }, attemptNumber: 1,
            finalProject: { title: 'Dự án Z', description: 'd', passingScore: 70, evaluationPipeline: [{ id: 1 }] },
          }));
          mock.method(EvaluationEngineService, 'evaluateProject', async () => ({ passed: true, totalScore: 88.4 }));
          return FinalProjectService.evaluateSubmission('sub', 'Bearer caller-token');
        },
        expected: { userId: USER, title: '🎉 Bài kiểm tra cuối kỳ ĐẠT!', message: 'Chúc mừng! Bài kiểm tra "Dự án Z" đạt 88%. Bạn đủ điều kiện nhận chứng chỉ lộ trình!', type: 'SUCCESS', link: `/final-project/${PATH}` },
        effect: () => !reverted() && loose.count('activityLog', 'create') >= 1,
      },
      {
        id: 'study-reminder.job.ts:42 reminder cron',
        drive: async () => {
          loose.on('studySchedule.findMany', [{ userId: USER, slots: [{ dayOfWeek: 3, startHour: 10, startMinute: 30, endHour: 11, endMinute: 0, activityLabel: 'Ôn tập' }] }]);
          mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 21, 10, 30, 0) }); // a Wednesday, 10:30 local time
          scheduled = null;
          startStudyReminderJob();
          assert.ok(scheduled, 'the job registered its cron callback');
          await scheduled!();
        },
        expected: { userId: USER, title: 'Đến giờ học rồi! ⏰', message: 'Bạn có một lịch học: Ôn tập lúc 10:30 - 11:00', type: 'INFO', link: '/my-learning' },
        effect: () => loose.count('studySchedule', 'findMany') === 1,
      },
    ];
  });

  beforeEach(() => {
    loose.reset();
    sent = [];
    logged = [];
    mode = 'ok';
    currentToken = useRandomInternalToken();
    process.env.USER_SERVICE_URL = 'http://user-service.test:3002';
    const { NOTIFICATIONS_PATH } = require('../src/services/user-notification.client');
    mock.method(axios, 'post', async (url: string, body: any, config: any) => {
      if (url.endsWith(NOTIFICATIONS_PATH)) {
        sent.push({ url, body, config, openTx: loose.openTransactions });
        if (mode === 'http500') throw axiosLike('Request failed with status code 500', { response: { status: 500 } }, config);
        if (mode === 'http403') throw axiosLike('Request failed with status code 403', { response: { status: 403 } }, config);
        if (mode === 'timeout') throw axiosLike('timeout of 5000ms exceeded', { code: 'ECONNABORTED' }, config);
        return { status: 201, data: { message: 'Notification created successfully' } };
      }
      if (url.endsWith('/api/ai/evaluate-submission')) return { data: { data: { totalScore: 80, stageResults: [], feedbackReport: 'tốt' } } };
      throw new Error(`unexpected POST ${url}`);
    });
    for (const level of ['error', 'warn', 'info', 'debug']) mock.method(logger, level, (...args: any[]) => { logged.push([level, ...args]); return logger; });
    // collaborators that are not under test
    mock.method(BadgeService, 'checkCourseCompleteBadge', async () => undefined);
    mock.method(BadgeService, 'checkSpeedLearnerBadge', async () => undefined);
    mock.method(BadgeService, 'checkTimeBasedBadge', async () => undefined);
    mock.method(AchievementService, 'recordCourseCompletion', async () => undefined);
    mock.method(LearnerAnalysisService, 'invalidateCache', async () => undefined);
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  it('there is one scenario for each of the 9 sites driven here (the other 2 have their own suites)', () => {
    assert.equal(SITES.length, 9);
    assert.equal(new Set(SITES.map((s) => s.id)).size, 9);
  });

  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    describe(`site #${index + 1}`, () => {
      const site = () => SITES[index];

      it('OK: one authenticated request with the exact payload, outside any transaction; the business effect happened; nothing logged as a failure', async () => {
        await site().drive();
        assert.equal(sent.length, 1, site().id);
        const call = sent[0];
        assert.equal(call.url, 'http://user-service.test:3002/api/users/internal/notifications');
        assert.equal(call.config.headers[HEADER], currentToken, 'the shared secret from the environment');
        assert.deepEqual(Object.keys(call.config.headers), [HEADER], 'no other header (idempotency keys are FIX 06C-4B2B)');
        assert.deepEqual(call.body, site().expected);
        assert.equal(call.openTx, 0, 'no database transaction is open while the request is made');
        assert.ok(site().effect(), 'business effect');
        assert.ok(!logText().includes(currentToken));
        assert.equal(logged.filter((l) => l[0] === 'error' && /notification|reminder/i.test(util.inspect(l))).length, 0, 'no notification failure logged');
      });

      for (const failing of ['http500', 'http403', 'timeout'] as const) {
        it(`${failing}: the flow still completes, exactly one request (no retry added), the failure is logged and the secret never is`, async () => {
          mode = failing;
          await site().drive(); // must not throw
          assert.equal(sent.length, 1, 'one attempt, as before');
          assert.ok(site().effect(), 'the business outcome does not depend on the notification');
          const text = logText();
          assert.ok(text.length > 40, 'the failure was logged, not swallowed silently');
          assert.ok(!text.includes(currentToken), 'the secret is not in anything that was logged');
          assert.ok(!text.includes(currentToken.slice(0, 10)));
          if (failing === 'http500') assert.match(text, /status code 500/);
          if (failing === 'http403') { assert.match(text, /status code 403/); assert.match(text, /rejected the internal service token/); }
          if (failing === 'timeout') assert.match(text, /timeout of 5000ms exceeded/);
        });
      }

      it('no INTERNAL_SERVICE_TOKEN: no request is made at all, the flow still completes, and the log says why', async () => {
        delete process.env.INTERNAL_SERVICE_TOKEN;
        await site().drive();
        assert.equal(sent.length, 0);
        assert.ok(site().effect());
        assert.match(logText(), /INTERNAL_SERVICE_TOKEN is not configured/);
      });
    });
  }
});
