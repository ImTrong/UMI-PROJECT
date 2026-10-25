/**
 * Wraps the REAL Prisma client (for integration tests against a real MongoDB) so chosen calls can be made
 * to fail - inside a $transaction (a genuine MongoDB rollback follows) or outside one. Service code runs
 * unmodified. Must be called BEFORE any service module is required.
 */
export type Fault = {
  model: string;
  op: string;
  error: Error;
  remaining: number;
  when?: (args: any) => boolean;
};

export function installFaultyPrisma() {
  const realModule = require('@prisma/client');
  const RealPrismaClient = realModule.PrismaClient;
  const faults: Fault[] = [];
  /**
   * Every model call that went through the client (also inside transactions), in order. For writes it also says WHAT is written
   * (field names of `data`, the new `status`, the audit `action`) - enough to label a transaction by the business write it performs.
   */
  type CallInfo = { model: string; op: string; fields?: string[]; status?: string; action?: string };
  const calls: CallInfo[] = [];
  const detail = (args: any): Partial<CallInfo> => {
    const d = args?.data;
    const first = Array.isArray(d) ? d[0] : d;
    if (!first || typeof first !== 'object') return {};
    const out: Partial<CallInfo> = { fields: Object.keys(first) };
    if (typeof first.status === 'string') out.status = first.status;
    if (typeof first.action === 'string') out.action = first.action;
    return out;
  };
  /**
   * Run (in order) right BEFORE every interactive transaction is started - i.e. while NO transaction is open. This is the place for a
   * test barrier: a worker parked here holds no MongoDB transaction and no lock on any document.
   */
  const txHooks: Array<() => Promise<void> | void> = [];
  /**
   * Run (in order) right AFTER an interactive transaction has finished (committed or rolled back), with the segment it performed.
   * Nothing is open at that moment either: this is where a test parks or kills a process "right after commit".
   */
  const txAfterHooks: Array<(seg: { calls: CallInfo[]; outcome: 'commit' | 'rollback' }) => Promise<void> | void> = [];
  /** Transaction boundaries as positions in `calls` (a retried transaction contributes one segment per attempt). */
  const txEvents: Array<{ kind: 'begin' | 'commit' | 'rollback'; at: number }> = [];
  const txSegments = () => {
    const out: Array<{ calls: CallInfo[]; outcome: 'commit' | 'rollback' }> = [];
    let begin = -1;
    for (const ev of txEvents) {
      if (ev.kind === 'begin') begin = ev.at;
      else if (begin >= 0) { out.push({ calls: calls.slice(begin, ev.at), outcome: ev.kind }); begin = -1; }
    }
    return out;
  };
  /** One-shot hooks run right before the next matching call (simulate another process racing us). */
  const hooks: Array<{ model: string; op: string; fn: (args: any) => Promise<void> | void }> = [];
  const beforeNext = (model: string, op: string, fn: (args: any) => Promise<void> | void) => hooks.push({ model, op, fn });

  const failNext = (model: string, op: string, error: Error, times = 1, when?: (args: any) => boolean) =>
    faults.push({ model, op, error, remaining: times, when });

  const maybeFail = (model: string, op: string, args: any): Error | null => {
    const f = faults.find((x) => x.model === model && x.op === op && x.remaining > 0 && (!x.when || x.when(args)));
    if (!f) return null;
    f.remaining--;
    return f.error;
  };

  const wrapModels = (client: any) =>
    new Proxy(client, {
      get(t, prop: string | symbol) {
        const v = (t as any)[prop];
        if (prop === '$runCommandRaw' && typeof v === 'function') {
          // raw commands (the lock fence is one) are part of the call log as { model: '$raw', op: <command name> }
          return async (cmd: any, ...rest: any[]) => {
            const op = Object.keys(cmd || {})[0] || '?';
            calls.push({ model: '$raw', op });
            const h = hooks.findIndex((x) => x.model === '$raw' && x.op === op);   // beforeNext('$raw', 'update', fn) runs right before the NEXT raw update
            if (h >= 0) await hooks.splice(h, 1)[0].fn(cmd);
            return v.call(t, cmd, ...rest);
          };
        }
        if (typeof prop !== 'string' || prop.startsWith('$') || !v || typeof v !== 'object') {
          return typeof v === 'function' ? v.bind(t) : v;
        }
        return new Proxy(v, {
          get(mt, op: string) {
            const fn = (mt as any)[op];
            if (typeof fn !== 'function') return fn;
            return async (...args: any[]) => {
              calls.push({ model: prop, op, ...detail(args[0]) });
              const h = hooks.findIndex((x) => x.model === prop && x.op === op);
              if (h >= 0) await hooks.splice(h, 1)[0].fn(args[0]);
              const err = maybeFail(prop, op, args[0]);
              if (err) throw err;
              return fn.apply(mt, args);
            };
          },
        });
      },
    });

  class FaultyPrismaClient {
    constructor(...args: any[]) {
      const real = new RealPrismaClient(...args);
      const models = wrapModels(real);
      return new Proxy(models, {
        get(t, prop: string | symbol) {
          if (prop === '$transaction') {
            return async (fn: any, opts?: any) => {
              if (typeof fn !== 'function') return real.$transaction(fn, opts);
              for (const hook of txHooks) await hook();             // no transaction is open here
              const finishedSegment = () => txSegments()[txSegments().length - 1];
              let result: any;
              try {
                result = await real.$transaction(async (tx: any) => {
                  txEvents.push({ kind: 'begin', at: calls.length });
                  try {
                    const r = await fn(wrapModels(tx));
                    txEvents.push({ kind: 'commit', at: calls.length });
                    return r;
                  } catch (e) {
                    txEvents.push({ kind: 'rollback', at: calls.length });
                    throw e;
                  }
                }, opts);
              } catch (e) {
                for (const hook of txAfterHooks) await hook(finishedSegment());
                throw e;
              }
              for (const hook of txAfterHooks) await hook(finishedSegment());   // committed; no transaction is open here
              return result;
            };
          }
          return (t as any)[prop];
        },
      });
    }
  }

  const resolved = require.resolve('@prisma/client');
  require.cache[resolved]!.exports = { ...realModule, PrismaClient: FaultyPrismaClient };

  return { faults, calls, txEvents, txSegments, txHooks, txAfterHooks, hooks, beforeNext, failNext, FaultyPrismaClient };
}
