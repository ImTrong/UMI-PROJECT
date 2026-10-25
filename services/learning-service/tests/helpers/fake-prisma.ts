/**
 * In-memory stand-in for @prisma/client, installed into require.cache BEFORE any
 * service module is loaded. It lets the real service code run end-to-end without a
 * database. It enforces the same unique keys as prisma/schema.prisma and yields to the
 * event loop on every call so concurrent requests really interleave.
 *
 * $transaction(fn): transactions are serialized (one at a time) and every write made through
 * the transaction client is undone if fn throws - i.e. all-or-nothing. This models atomicity
 * and rollback, NOT MongoDB's snapshot/write-conflict behaviour; that is covered by
 * tests/integration/redemption.mongo.test.ts against a real replica set.
 *
 * Failure injection: db.failNext('rewardPointTransaction', 'create') makes the next such call throw.
 */

type Doc = Record<string, any>;

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

let idCounter = 0;
const nextId = () => `id${String(++idCounter).padStart(6, '0')}`;

const isPlainObject = (v: any) => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);

const flattenWhere = (where: Doc = {}): Doc => {
  const flat: Doc = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR' || key === 'AND') continue;
    if (key.includes('_') && isPlainObject(value) && !('in' in value) && !('not' in value)) {
      Object.assign(flat, value); // compound unique key e.g. userId_courseId
    } else {
      flat[key] = value;
    }
  }
  return flat;
};

const matches = (doc: Doc, where: Doc = {}): boolean => {
  if (Array.isArray(where.OR) && !where.OR.some((w: Doc) => matches(doc, w))) return false;
  if (Array.isArray(where.AND) && !where.AND.every((w: Doc) => matches(doc, w))) return false;
  const flat = flattenWhere(where);
  return Object.entries(flat).every(([key, cond]) => {
    const actual = doc[key];
    // Mongo/Prisma: `null` matches an explicit null only; an ABSENT field needs `isSet: false`
    if (cond === null) return actual === null;
    if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
    if (isPlainObject(cond)) {
      if ('isSet' in cond) return cond.isSet ? actual !== undefined : actual === undefined;
      if ('in' in cond) return cond.in.includes(actual);
      if ('not' in cond) return cond.not === null ? actual !== null && actual !== undefined : actual !== cond.not;
      if ('gte' in cond) return actual >= cond.gte;
      if ('lt' in cond) return actual !== null && actual !== undefined && actual < cond.lt;
    }
    return actual === cond;
  });
};

const uniqueKeys: Record<string, string[]> = {
  courseProgress: ['userId', 'courseId'],
  lessonProgress: ['userId', 'courseId', 'lessonId'],
  userProgress: ['userId'],
  quiz: ['lessonId'],
  userRewardPoint: ['userId'],
  rewardPointTransaction: ['idempotencyKey'],
  courseRedemption: ['userId', 'courseId'],
  monthlyLeaderboard: ['month', 'year'],
  leaderboardEntry: ['leaderboardId', 'userId'],
  badge: ['userId', 'badgeName'],
};

const hasUpdatedAt = new Set(['courseRedemption', 'userRewardPoint', 'monthlyLeaderboard']);

const defaults: Record<string, () => Doc> = {
  courseProgress: () => ({
    enrolledAt: new Date(), completedAt: null, progressPercentage: 0, totalLessons: 0,
    completedLessons: 0, timeSpentSeconds: 0, lastAccessedAt: new Date(), averageQuizScore: null,
    passed: null, allowRetake: false, passingScore: 80, retakeCount: 0,
  }),
  lessonProgress: () => ({
    completed: false, completedAt: null, timeSpentSeconds: 0, lastWatchedAt: new Date(), watchCount: 0,
  }),
  userRewardPoint: () => ({ balance: 0, totalEarned: 0, totalSpent: 0 }),
  rewardPointTransaction: () => ({ metadata: {}, createdAt: new Date() }),
  courseRedemption: () => ({
    attempts: 0, lastError: null, refundTransactionId: null, createdAt: new Date(),
    // leaseUntil deliberately ABSENT unless set (what Prisma writes to Mongo for an omitted optional field)
  }),
  monthlyLeaderboard: () => ({
    status: 'ACTIVE', finalizedAt: null, totalParticipants: 0, totalPointsAwarded: 0, policyVersion: '1.0', createdAt: new Date(),
  }),
  leaderboardEntry: () => ({
    points: 0, completedCourses: 0, rewardPoints: 0, rewardBadgeId: null, scoreBreakdown: [], isTie: false,
    // rewardNotifiedAt / rewardNotifyError deliberately ABSENT until set (as Prisma writes them to Mongo)
  }),
  badge: () => ({ metadata: {}, earnedAt: new Date() }),
  courseCompletionRecord: () => ({}),
  userProgress: () => ({
    totalCoursesEnrolled: 0, totalCoursesCompleted: 0, totalLessonsCompleted: 0, totalStudyTime: 0,
    streakDays: 0, lastActivityDate: null,
  }),
  quizAttempt: () => ({
    score: 0, correctAnswers: 0, passed: false, status: 'IN_PROGRESS', startedAt: new Date(),
    submittedAt: null, timeTakenSeconds: null,
  }),
};

type Failure = { table: string; op: string; error: Error; remaining: number; when?: (args: any) => boolean };

export class FakeDb {
  tables: Record<string, Doc[]> = {
    courseProgress: [], lessonProgress: [], userProgress: [], quiz: [], quizAttempt: [], activityLog: [],
    userRewardPoint: [], rewardPointTransaction: [], courseRedemption: [], leaderboardAuditLog: [],
    monthlyLeaderboard: [], leaderboardEntry: [], badge: [], courseCompletionRecord: [],
  };
  failures: Failure[] = [];
  /** Every model call made (also inside transactions): { table, op } in order. */
  calls: Array<{ table: string; op: string; where?: any }> = [];
  /** Transaction boundaries as positions in `calls` (txSegments() turns them into per-transaction call lists). */
  txEvents: Array<{ kind: 'begin' | 'commit' | 'rollback'; at: number }> = [];
  /** One-shot hooks run right BEFORE a matching call (used to simulate another process racing us). */
  hooks: Array<{ table: string; op: string; fn: (args: any) => void | Promise<void> }> = [];
  /** Number of $transaction calls that were rolled back */
  rollbacks = 0;
  /** Transactions running right now (so a test can assert that nothing slow - e.g. HTTP - happens inside one). */
  openTransactions = 0;
  maxOpenTransactions = 0;

  reset() {
    for (const key of Object.keys(this.tables)) this.tables[key] = [];
    this.failures = [];
    this.calls = [];
    this.txEvents = [];
    this.hooks = [];
    this.rollbacks = 0;
    this.openTransactions = 0;
    this.maxOpenTransactions = 0;
  }

  count(table: string) {
    return this.tables[table].length;
  }

  seed(table: string, doc: Doc): Doc {
    const row: Doc = { id: nextId(), ...(defaults[table]?.() ?? {}), ...doc };
    if (hasUpdatedAt.has(table) && !row.updatedAt) row.updatedAt = new Date();
    this.tables[table].push(row);
    return row;
  }

  /** Runs `fn` once, right before the next table.op call. */
  beforeNext(table: string, op: string, fn: (args: any) => void | Promise<void>) {
    this.hooks.push({ table, op, fn });
  }

  /** Number of calls of table.op since the last reset. */
  callCount(table: string, op: string) {
    return this.calls.filter((c) => c.table === table && c.op === op).length;
  }

  /** The calls made inside each transaction, in order, with how it ended. */
  txSegments(): Array<{ calls: Array<{ table: string; op: string; where?: any }>; outcome: 'commit' | 'rollback' }> {
    const out: Array<{ calls: Array<{ table: string; op: string; where?: any }>; outcome: 'commit' | 'rollback' }> = [];
    let begin = -1;
    for (const ev of this.txEvents) {
      if (ev.kind === 'begin') begin = ev.at;
      else if (begin >= 0) {
        out.push({ calls: this.calls.slice(begin, ev.at), outcome: ev.kind });
        begin = -1;
      }
    }
    return out;
  }

  /** All calls that can change data. */
  writeCalls(tables?: string[]) {
    const writes = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'deleteMany']);
    return this.calls.filter((c) => writes.has(c.op) && (!tables || tables.includes(c.table)));
  }

  /** The next `times` calls of table.op throw `error`. */
  failNext(table: string, op: string, error: Error = new Error(`injected ${table}.${op} failure`), times = 1, when?: (args: any) => boolean) {
    this.failures.push({ table, op, error, remaining: times, when });
  }

  maybeFail(table: string, op: string, args?: any) {
    const f = this.failures.find((x) => x.table === table && x.op === op && x.remaining > 0 && (!x.when || x.when(args)));
    if (f) {
      f.remaining--;
      throw f.error;
    }
  }
}

export const db = new FakeDb();

type Undo = () => void;

const applyData = (table: string, row: Doc, data: Doc) => {
  for (const [k, v] of Object.entries(data)) {
    if (isPlainObject(v) && 'increment' in v) row[k] = (row[k] || 0) + v.increment;
    else if (isPlainObject(v) && 'decrement' in v) row[k] = (row[k] || 0) - v.decrement;
    else if (v !== undefined) row[k] = v;
  }
  if (hasUpdatedAt.has(table)) row.updatedAt = new Date();
};

const snapshot = (row: Doc): Undo => {
  const before = { ...row };
  return () => {
    for (const k of Object.keys(row)) delete row[k];
    Object.assign(row, before);
  };
};

const makeModel = (table: string, undo?: Undo[]) => {
  const rows = () => db.tables[table];
  const record = (fn: Undo) => undo?.push(fn);
  const model: Record<string, (args?: any) => Promise<any>> = {
    async findUnique({ where, include, select }: any) {
      await tick();
      const found = rows().find((r) => matches(r, where)) ?? null;
      if (found && include?.quiz) return { ...found, quiz: db.tables.quiz.find((q) => q.id === found.quizId) };
      if (found && include?.entries) {
        const entries = db.tables.leaderboardEntry.filter((e) => e.leaderboardId === found.id).map((e) => ({ ...e }));
        if (include.entries.orderBy?.rank === 'asc') entries.sort((a, b) => a.rank - b.rank);
        return { ...found, entries };
      }
      if (found && select) return Object.fromEntries(Object.keys(select).map((k) => [k, found[k]]));
      return found;
    },
    async findUniqueOrThrow(args: any) {
      const found = await model.findUnique(args);
      if (!found) throw new Error('Record not found');
      return found;
    },
    async findFirst({ where, orderBy }: any = {}) {
      await tick();
      const list = rows().filter((r) => matches(r, where));
      if (orderBy?.score === 'desc') list.sort((a, b) => b.score - a.score);
      return list[0] ?? null;
    },
    async findMany({ where, orderBy, skip = 0, take, cursor }: any = {}) {
      await tick();
      let list = rows().filter((r) => matches(r, where));
      const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
      for (const o of [...order].reverse()) {
        const [k, dir] = Object.entries(o)[0] as [string, string];
        list = [...list].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      if (cursor) {
        const idx = list.findIndex((r) => r.id === cursor.id);
        list = idx >= 0 ? list.slice(idx) : [];
      }
      return list.slice(skip, take ? skip + take : undefined);
    },
    async count({ where }: any = {}) {
      await tick();
      return rows().filter((r) => matches(r, where)).length;
    },
    async aggregate({ where, _sum }: any) {
      await tick();
      const list = rows().filter((r) => matches(r, where));
      const sum: Doc = {};
      for (const k of Object.keys(_sum || {})) sum[k] = list.reduce((a, r) => a + (r[k] || 0), 0);
      return { _sum: sum };
    },
    async create({ data }: any) {
      await tick();
      const keys = uniqueKeys[table];
      if (keys && rows().some((r) => keys.every((k) => r[k] === data[k]) && (table !== 'rewardPointTransaction' || data.idempotencyKey != null))) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = { id: nextId(), ...(defaults[table]?.() ?? {}), ...data };
      if (hasUpdatedAt.has(table)) row.updatedAt = new Date();
      rows().push(row);
      record(() => { db.tables[table] = db.tables[table].filter((r) => r !== row); });
      return row;
    },
    async update({ where, data }: any) {
      await tick();
      const row = rows().find((r) => matches(r, where));
      if (!row) throw new Error('Record to update not found');
      record(snapshot(row));
      applyData(table, row, data);
      return row;
    },
    async updateMany({ where, data }: any) {
      await tick();
      const list = rows().filter((r) => matches(r, where));
      list.forEach((r) => { record(snapshot(r)); applyData(table, r, data); });
      return { count: list.length };
    },
    async upsert({ where, update, create }: any) {
      await tick();
      const row = rows().find((r) => matches(r, where));
      if (row) { record(snapshot(row)); applyData(table, row, update); return row; }
      const created = { id: nextId(), ...(defaults[table]?.() ?? {}), ...create };
      rows().push(created);
      record(() => { db.tables[table] = db.tables[table].filter((r) => r !== created); });
      return created;
    },
    async createMany({ data }: any) {
      await tick();
      let count = 0;
      for (const d of data) { await model.create({ data: d }); count++; }
      return { count };
    },
    async deleteMany({ where }: any = {}) {
      await tick();
      const removed = rows().filter((r) => matches(r, where));
      db.tables[table] = rows().filter((r) => !removed.includes(r));
      record(() => { db.tables[table].push(...removed); });
      return { count: removed.length };
    },
  };
  const cloneRow = (r: any): any => (r && typeof r === 'object' && !(r instanceof Date) ? { ...r } : r);
  const cloneResult = (v: any): any => (Array.isArray(v) ? v.map(cloneRow) : cloneRow(v));
  for (const op of Object.keys(model)) {
    const original = model[op];
    model[op] = async (args?: any) => {
      db.calls.push({ table, op, where: args?.where });
      const hookIndex = db.hooks.findIndex((h) => h.table === table && h.op === op);
      if (hookIndex >= 0) {
        const [hook] = db.hooks.splice(hookIndex, 1);
        await hook.fn(args);
      }
      db.maybeFail(table, op, args);
      const result = await original(args);
      return ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findMany', 'create', 'update', 'upsert'].includes(op)
        ? cloneResult(result)
        : result;
    };
  }
  return model;
};

const buildClient = (undo?: Undo[]) => ({
  courseProgress: makeModel('courseProgress', undo),
  lessonProgress: makeModel('lessonProgress', undo),
  userProgress: makeModel('userProgress', undo),
  quiz: makeModel('quiz', undo),
  quizAttempt: makeModel('quizAttempt', undo),
  activityLog: makeModel('activityLog', undo),
  userRewardPoint: makeModel('userRewardPoint', undo),
  rewardPointTransaction: makeModel('rewardPointTransaction', undo),
  courseRedemption: makeModel('courseRedemption', undo),
  leaderboardAuditLog: makeModel('leaderboardAuditLog', undo),
  monthlyLeaderboard: makeModel('monthlyLeaderboard', undo),
  leaderboardEntry: makeModel('leaderboardEntry', undo),
  badge: makeModel('badge', undo),
  courseCompletionRecord: makeModel('courseCompletionRecord', undo),
});

let txQueue: Promise<unknown> = Promise.resolve();

export class FakePrismaClient {
  courseProgress = makeModel('courseProgress');
  lessonProgress = makeModel('lessonProgress');
  userProgress = makeModel('userProgress');
  quiz = makeModel('quiz');
  quizAttempt = makeModel('quizAttempt');
  activityLog = makeModel('activityLog');
  userRewardPoint = makeModel('userRewardPoint');
  rewardPointTransaction = makeModel('rewardPointTransaction');
  courseRedemption = makeModel('courseRedemption');
  leaderboardAuditLog = makeModel('leaderboardAuditLog');
  monthlyLeaderboard = makeModel('monthlyLeaderboard');
  leaderboardEntry = makeModel('leaderboardEntry');
  badge = makeModel('badge');
  courseCompletionRecord = makeModel('courseCompletionRecord');

  async $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const run = async () => {
      const undo: Undo[] = [];
      db.openTransactions++;
      db.maxOpenTransactions = Math.max(db.maxOpenTransactions, db.openTransactions);
      db.txEvents.push({ kind: 'begin', at: db.calls.length });
      try {
        const result = await fn(buildClient(undo));
        db.txEvents.push({ kind: 'commit', at: db.calls.length });
        return result;
      } catch (e) {
        for (const u of undo.reverse()) u();
        db.rollbacks++;
        db.txEvents.push({ kind: 'rollback', at: db.calls.length });
        throw e;
      } finally {
        db.openTransactions--;
      }
    };
    const result = txQueue.then(run, run);
    txQueue = result.catch(() => undefined);
    return result;
  }
}

export const QuizAttemptStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  TIMED_OUT: 'TIMED_OUT',
} as const;

/** Must be called before importing any service module. */
export const installFakePrisma = () => {
  const resolved = require.resolve('@prisma/client');
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: { PrismaClient: FakePrismaClient, QuizAttemptStatus },
  } as any;
};
