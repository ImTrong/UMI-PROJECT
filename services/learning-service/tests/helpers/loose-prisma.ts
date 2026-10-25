/**
 * A deliberately LOOSE stand-in for @prisma/client (FIX 06C-4B2A), for tests that only need a service function to run up to - and
 * past - its notification call without caring about the data layer. Unlike fake-prisma.ts it knows no tables: any `prisma.<model>.<op>(args)`
 * is answered by a handler the test registered for "<model>.<op>", or by a harmless default (findMany -> [], findUnique -> null,
 * count -> 0, create / update -> the written data plus an id, ...). Every call is recorded.
 *
 * It also counts open `$transaction`s, so a test can see how many were running at the instant a notification request was made.
 * Install it BEFORE any service module is loaded:  installLoosePrisma();
 */
type Handler = (args: any, call: { model: string; op: string; index: number }) => any;

export interface LooseCall { model: string; op: string; args: any; openTransactions: number }

class LooseState {
  handlers = new Map<string, Handler>();
  calls: LooseCall[] = [];
  openTransactions = 0;
  private seq = 0;

  reset() {
    this.handlers.clear();
    this.calls = [];
    this.openTransactions = 0;
    this.seq = 0;
  }
  on(key: string, handler: Handler | any) {
    this.handlers.set(key, typeof handler === 'function' ? handler : () => handler);
  }
  /** How many times `model.op` was called. */
  count(model: string, op: string) {
    return this.calls.filter((c) => c.model === model && c.op === op).length;
  }
  nextId() {
    return `id${String(++this.seq).padStart(6, '0')}`;
  }
}

export const loose = new LooseState();

const defaults: Record<string, (args: any) => any> = {
  findMany: () => [],
  findFirst: () => null,
  findUnique: () => null,
  count: () => 0,
  aggregate: () => ({}),
  groupBy: () => [],
  create: (a) => ({ id: loose.nextId(), ...(a?.data ?? {}) }),
  createMany: (a) => ({ count: Array.isArray(a?.data) ? a.data.length : 0 }),
  update: (a) => ({ id: a?.where?.id ?? loose.nextId(), ...(a?.data ?? {}) }),
  updateMany: () => ({ count: 0 }),
  upsert: (a) => ({ id: loose.nextId(), ...(a?.create ?? {}) }),
  delete: () => ({}),
  deleteMany: () => ({ count: 0 }),
};

const client: any = new Proxy(
  {},
  {
    get(_target, model) {
      if (typeof model !== 'string') return undefined;
      if (model === '$transaction') {
        return async (fn: (tx: any) => Promise<any>) => {
          loose.openTransactions++;
          try {
            return await fn(client);
          } finally {
            loose.openTransactions--;
          }
        };
      }
      if (model === '$connect' || model === '$disconnect') return async () => undefined;
      if (model === 'then') return undefined; // never look like a thenable
      return new Proxy(
        {},
        {
          get(_m, op) {
            if (typeof op !== 'string') return undefined;
            return async (args?: any) => {
              const call = { model, op, args, openTransactions: loose.openTransactions };
              loose.calls.push(call);
              const handler = loose.handlers.get(`${model}.${op}`);
              if (handler) return handler(args, { model, op, index: loose.calls.length - 1 });
              return (defaults[op] ?? (() => null))(args);
            };
          },
        }
      );
    },
  }
);

export function installLoosePrisma() {
  const resolved = require.resolve('@prisma/client');
  function LoosePrismaClient(this: any) {
    return client;
  }
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {
      PrismaClient: LoosePrismaClient,
      QuizAttemptStatus: { IN_PROGRESS: 'IN_PROGRESS', SUBMITTED: 'SUBMITTED', TIMED_OUT: 'TIMED_OUT' },
    },
  } as any;
}
