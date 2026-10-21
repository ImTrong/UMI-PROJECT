/**
 * In-memory stand-in for @prisma/client, installed into require.cache BEFORE any
 * service module is loaded. It lets the real service code run end-to-end without a
 * database. It enforces the same unique keys as prisma/schema.prisma
 * (CourseProgress[userId,courseId], LessonProgress[userId,courseId,lessonId]) and
 * yields to the event loop on every call so concurrent requests really interleave.
 */

type Doc = Record<string, any>;

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

let idCounter = 0;
const nextId = () => `id${String(++idCounter).padStart(6, '0')}`;

const flattenWhere = (where: Doc = {}): Doc => {
  const flat: Doc = {};
  for (const [key, value] of Object.entries(where)) {
    if (key.includes('_') && value && typeof value === 'object' && !('in' in value) && !('not' in value)) {
      Object.assign(flat, value); // compound unique key e.g. userId_courseId
    } else {
      flat[key] = value;
    }
  }
  return flat;
};

const matches = (doc: Doc, where: Doc = {}): boolean => {
  const flat = flattenWhere(where);
  return Object.entries(flat).every(([key, cond]) => {
    const actual = doc[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(actual);
      if ('not' in cond) return cond.not === null ? actual !== null && actual !== undefined : actual !== cond.not;
      if ('gte' in cond) return actual >= cond.gte;
    }
    return actual === cond;
  });
};

const uniqueKeys: Record<string, string[]> = {
  courseProgress: ['userId', 'courseId'],
  lessonProgress: ['userId', 'courseId', 'lessonId'],
  userProgress: ['userId'],
  quiz: ['lessonId'],
};

const defaults: Record<string, () => Doc> = {
  courseProgress: () => ({
    enrolledAt: new Date(), completedAt: null, progressPercentage: 0, totalLessons: 0,
    completedLessons: 0, timeSpentSeconds: 0, lastAccessedAt: new Date(), averageQuizScore: null,
    passed: null, allowRetake: false, passingScore: 80, retakeCount: 0,
  }),
  lessonProgress: () => ({
    completed: false, completedAt: null, timeSpentSeconds: 0, lastWatchedAt: new Date(), watchCount: 0,
  }),
  userProgress: () => ({
    totalCoursesEnrolled: 0, totalCoursesCompleted: 0, totalLessonsCompleted: 0, totalStudyTime: 0,
    streakDays: 0, lastActivityDate: null,
  }),
  quizAttempt: () => ({
    score: 0, correctAnswers: 0, passed: false, status: 'IN_PROGRESS', startedAt: new Date(),
    submittedAt: null, timeTakenSeconds: null,
  }),
};

export class FakeDb {
  tables: Record<string, Doc[]> = {
    courseProgress: [], lessonProgress: [], userProgress: [], quiz: [], quizAttempt: [], activityLog: [],
  };

  reset() {
    for (const key of Object.keys(this.tables)) this.tables[key] = [];
  }

  count(table: string) {
    return this.tables[table].length;
  }

  seed(table: string, doc: Doc): Doc {
    const row = { id: nextId(), ...(defaults[table]?.() ?? {}), ...doc };
    this.tables[table].push(row);
    return row;
  }
}

export const db = new FakeDb();

const makeModel = (table: string) => {
  const rows = () => db.tables[table];
  const model: Record<string, (args?: any) => Promise<any>> = {
    async findUnique({ where, include, select }: any) {
      await tick();
      const found = rows().find((r) => matches(r, where)) ?? null;
      if (found && include?.quiz) return { ...found, quiz: db.tables.quiz.find((q) => q.id === found.quizId) };
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
    async findMany({ where, orderBy, skip = 0, take }: any = {}) {
      await tick();
      let list = rows().filter((r) => matches(r, where));
      const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
      for (const o of [...order].reverse()) {
        const [k, dir] = Object.entries(o)[0] as [string, string];
        list = [...list].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
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
      if (keys && rows().some((r) => keys.every((k) => r[k] === data[k]))) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = { id: nextId(), ...(defaults[table]?.() ?? {}), ...data };
      rows().push(row);
      return row;
    },
    async update({ where, data }: any) {
      await tick();
      const row = rows().find((r) => matches(r, where));
      if (!row) throw new Error('Record to update not found');
      applyData(row, data);
      return row;
    },
    async updateMany({ where, data }: any) {
      await tick();
      const list = rows().filter((r) => matches(r, where));
      list.forEach((r) => applyData(r, data));
      return { count: list.length };
    },
    async upsert({ where, update, create }: any) {
      await tick();
      const row = rows().find((r) => matches(r, where));
      if (row) { applyData(row, update); return row; }
      const created = { id: nextId(), ...(defaults[table]?.() ?? {}), ...create };
      rows().push(created);
      return created;
    },
    async deleteMany({ where }: any = {}) {
      await tick();
      const before = rows().length;
      db.tables[table] = rows().filter((r) => !matches(r, where));
      return { count: before - db.tables[table].length };
    },
  };
  return model;
};

const applyData = (row: Doc, data: Doc) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) row[k] = (row[k] || 0) + v.increment;
    else if (v !== undefined) row[k] = v;
  }
};

export class FakePrismaClient {
  courseProgress = makeModel('courseProgress');
  lessonProgress = makeModel('lessonProgress');
  userProgress = makeModel('userProgress');
  quiz = makeModel('quiz');
  quizAttempt = makeModel('quizAttempt');
  activityLog = makeModel('activityLog');
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
