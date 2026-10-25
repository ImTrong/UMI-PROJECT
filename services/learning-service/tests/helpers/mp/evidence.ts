/**
 * Evidence read straight from MongoDB (FIX 06C-2): the tests never trust a return value alone.
 *
 *   fingerprint()         every document of every collection the finalization touches, byte for byte (raw EJSON, sorted by _id)
 *   lock()                the lock row as MongoDB sees it, including MongoDB's OWN clock ($$NOW) and its verdict on expiry
 *   waitUntilMongoSaysExpired()   polls MongoDB until MongoDB itself says the lease is over (no fixed sleep is used as proof)
 *   oplog                 the replica set's oplog (local.oplog.rs): every write with MongoDB's wall-clock time, transactions unpacked.
 *                         From it: the exact sequence of status changes of a period, and whether anything other than lock
 *                         bookkeeping was written after a given moment.
 *   summary()             the business outcome without ids / timestamps / fencing tokens (for comparing two runs)
 */
export const COLLECTIONS = [
  'monthly_leaderboards',
  'leaderboard_entries',
  'reward_point_transactions',
  'user_reward_points',
  'badges',
  'leaderboard_audit_logs',
  'course_completion_records',
] as const;

const num = (v: any): number | null => {
  if (typeof v === 'number') return v;
  const w = v?.$numberInt ?? v?.$numberLong ?? v?.$numberDouble;
  return w === undefined ? null : Number(w);
};
/** ObjectId fields come back as {$oid}, string fields as strings: compare both uniformly. */
const idOf = (v: any): string => (v && typeof v === 'object' && '$oid' in v ? v.$oid : String(v));
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const date = (v: any): Date | null => {
  const d = v?.$date;
  if (d === undefined) return null;
  return new Date(typeof d === 'string' ? d : Number(d?.$numberLong ?? d));
};

export interface LockRow {
  count: number;
  periodId?: string;
  status?: string;
  lockToken: string | null;
  lockOwner: string | null;
  fencingToken: number | null;
  lockExpiresAt: Date | null;
  serverNow: Date;
  expired: boolean | null;
  remainingMs: number | null;
}

export interface OplogWrite {
  wall: Date;
  ts: any;
  op: 'i' | 'u' | 'd';
  coll: string;
  id: string;
  viaTransaction: boolean;
  /** The whole document after an insert / replacing update; the changed fields after a diff update. */
  body: Record<string, any>;
  diff: boolean;
  /** For monthly_leaderboards: the document state after this write, from replaying the window (null if unknown). */
  periodAfter: Record<string, any> | null;
  periodBefore: Record<string, any> | null;
}

/** Fields whose change is lock bookkeeping, not a business change of the period. */
const LOCK_ONLY = new Set(['lockToken', 'lockOwner', 'lockExpiresAt', 'lockHeartbeatAt', 'fencingToken', 'fenceSeq', 'updatedAt']);

export class Evidence {
  constructor(readonly admin: any, readonly local: any, readonly dbName: string) {}

  // ------------------------------------------------------------------ documents
  async raw(coll: string, filter: Record<string, unknown> = {}): Promise<any[]> {
    const r: any = await this.admin.$runCommandRaw({ find: coll, filter, sort: { _id: 1 }, batchSize: 5000 });
    return r.cursor.firstBatch;
  }

  async fingerprint(collections: readonly string[] = COLLECTIONS): Promise<string> {
    const out: Record<string, any[]> = {};
    for (const c of collections) out[c] = await this.raw(c);
    return JSON.stringify(out);
  }

  async reset() {
    for (const c of COLLECTIONS) await this.admin.$runCommandRaw({ delete: c, deletes: [{ q: {}, limit: 0 }] });
  }

  // ------------------------------------------------------------------ the lock, from MongoDB's point of view
  async lock(month: number, year: number): Promise<LockRow> {
    const count = await this.admin.monthlyLeaderboard.count({ where: { month, year } });
    const r: any = await this.admin.$runCommandRaw({
      aggregate: 'monthly_leaderboards',
      pipeline: [
        { $match: { month, year } },
        {
          $project: {
            status: 1, lockToken: 1, lockOwner: 1, fencingToken: 1, lockExpiresAt: 1, serverNow: '$$NOW',
            expired: { $cond: [{ $eq: [{ $ifNull: ['$lockExpiresAt', null] }, null] }, null, { $lt: ['$lockExpiresAt', '$$NOW'] }] },
            remainingMs: { $cond: [{ $eq: [{ $ifNull: ['$lockExpiresAt', null] }, null] }, null, { $subtract: ['$lockExpiresAt', '$$NOW'] }] },
          },
        },
      ],
      cursor: {},
    });
    const d = r.cursor.firstBatch[0] || {};
    return {
      count,
      periodId: d._id?.$oid,
      status: d.status,
      lockToken: typeof d.lockToken === 'string' ? d.lockToken : null,
      lockOwner: typeof d.lockOwner === 'string' ? d.lockOwner : null,
      fencingToken: num(d.fencingToken),
      lockExpiresAt: date(d.lockExpiresAt),
      serverNow: date(d.serverNow) as Date,
      expired: typeof d.expired === 'boolean' ? d.expired : null,
      remainingMs: num(d.remainingMs),
    };
  }

  async waitUntilMongoSaysExpired(month: number, year: number, timeoutMs = 15_000): Promise<LockRow> {
    const t0 = Date.now();
    for (;;) {
      const s = await this.lock(month, year);
      if (s.expired === true) return s;
      if (Date.now() - t0 > timeoutMs) throw new Error(`MongoDB still reports the lease of ${month}/${year} as valid after ${timeoutMs} ms: ${JSON.stringify(s)}`);
      await new Promise((r) => setTimeout(r, 75));
    }
  }

  // ------------------------------------------------------------------ the oplog
  /** A moment in the oplog (and the state of the periods at that moment, so diff updates can be replayed). */
  async oplogMarker(): Promise<{ ts: any; periods: Map<string, Record<string, any>> }> {
    // only the position: the newest entry may belong to another database and hold values this client cannot decode
    const last: any = await this.local.$runCommandRaw({ find: 'oplog.rs', sort: { $natural: -1 }, limit: 1, projection: { ts: 1 } });
    const periods = new Map<string, Record<string, any>>();
    for (const p of await this.raw('monthly_leaderboards')) periods.set(p._id.$oid, p);
    return { ts: last.cursor.firstBatch[0].ts, periods };
  }

  /** Every write to this database after the marker, in order, with MongoDB's wall-clock time. Transactions are unpacked. */
  async writesSince(marker: { ts: any; periods: Map<string, Record<string, any>> }): Promise<OplogWrite[]> {
    // Filtered by namespace ON THE SERVER: other suites sharing the replica set write their own entries (e.g. index specs with
    // `$type`) that would otherwise come back in the same batch and break decoding ("Unknown tagged value").
    const nsPattern = { $regularExpression: { pattern: `^${escapeRegExp(this.dbName)}\\.`, options: '' } };
    const r: any = await this.local.$runCommandRaw({
      find: 'oplog.rs',
      filter: { ts: { $gt: marker.ts }, $or: [{ ns: nsPattern }, { op: 'c', ns: 'admin.$cmd', 'o.applyOps.ns': nsPattern }] },
      sort: { $natural: 1 },
      batchSize: 20000,
    });
    const state = new Map<string, Record<string, any>>([...marker.periods].map(([k, v]) => [k, { ...v }]));
    const out: OplogWrite[] = [];
    const prefix = `${this.dbName}.`;
    const push = (x: any, wall: Date, ts: any, viaTransaction: boolean) => {
      if (!x?.ns || !String(x.ns).startsWith(prefix) || !['i', 'u', 'd'].includes(x.op)) return;
      const coll = String(x.ns).slice(prefix.length);
      const id = (x.o2?._id ?? x.o?._id)?.$oid ?? JSON.stringify(x.o2?._id ?? x.o?._id);
      let body: Record<string, any> = {};
      let diff = false;
      if (x.op === 'i') body = x.o;
      else if (x.op === 'u') {
        if (x.o?.$v === 2 && x.o.diff) {
          diff = true;
          body = { ...(x.o.diff.i || {}), ...(x.o.diff.u || {}) };
          for (const k of Object.keys(x.o.diff.d || {})) body[k] = undefined;
        } else body = x.o; // replacing update (pipeline updates are logged as the whole new document)
      }
      let periodBefore: Record<string, any> | null = null;
      let periodAfter: Record<string, any> | null = null;
      if (coll === 'monthly_leaderboards') {
        periodBefore = state.has(id) ? { ...state.get(id)! } : null;
        if (x.op === 'i') state.set(id, { ...x.o });
        else if (x.op === 'd') state.delete(id);
        else if (diff) {
          const cur = { ...(state.get(id) || {}) };
          for (const [k, v] of Object.entries(body)) { if (v === undefined) delete cur[k]; else cur[k] = v; }
          state.set(id, cur);
        } else state.set(id, { ...x.o });
        periodAfter = state.get(id) ? { ...state.get(id)! } : null;
      }
      out.push({ wall, ts, op: x.op, coll, id, viaTransaction, body, diff, periodBefore, periodAfter });
    };
    for (const e of r.cursor.firstBatch) {
      const wall = date(e.wall) as Date;
      if (e.op === 'c' && e.ns === 'admin.$cmd' && Array.isArray(e.o?.applyOps)) for (const inner of e.o.applyOps) push(inner, wall, e.ts, true);
      else push(e, wall, e.ts, false);
    }
    return out;
  }

  /** The distinct, ordered statuses a period went through in a window (consecutive repeats collapsed). */
  static statusSequence(writes: OplogWrite[]): string[] {
    const seq: string[] = [];
    for (const w of writes) {
      if (w.coll !== 'monthly_leaderboards' || !w.periodAfter) continue;
      const st = w.periodAfter.status;
      if (typeof st === 'string' && seq[seq.length - 1] !== st) {
        if (seq.length === 0 && w.periodBefore && typeof w.periodBefore.status === 'string' && w.periodBefore.status !== st) seq.push(w.periodBefore.status);
        seq.push(st);
      }
    }
    return seq;
  }

  /** Writes that are NOT lock bookkeeping: any write outside monthly_leaderboards, and any change to a period other than the lock fields. */
  static businessWrites(writes: OplogWrite[]): OplogWrite[] {
    return writes.filter((w) => {
      if (w.coll !== 'monthly_leaderboards') return true;
      if (w.op !== 'u' || !w.periodBefore || !w.periodAfter) return true;
      const keys = new Set([...Object.keys(w.periodBefore), ...Object.keys(w.periodAfter)]);
      for (const k of keys) {
        if (LOCK_ONLY.has(k)) continue;
        if (JSON.stringify(w.periodBefore[k]) !== JSON.stringify(w.periodAfter[k])) return true;
      }
      return false;
    });
  }

  // ------------------------------------------------------------------ business outcome of one period
  /**
   * Everything of business meaning of one period, field by field, for comparing a RECOVERED run with a plain one: the snapshot content, the
   * ledger (user, type, amount, balanceAfter, source, key, month / year, rank, description), wallets (balance, totalEarned, totalSpent), badges
   * (name, type, description, icon, metadata), the full audit rows and the period. Operational fields are left out on purpose: ids (every _id is
   * replaced by a placeholder), createdAt / updatedAt, the lock fields and fencing token, finalizedAt (only whether it is set) and finalizedBy
   * (the label of whoever ran). Nothing of business meaning is left out to make two runs match.
   */
  async deepSummary(month: number, year: number): Promise<string> {
    const period = (await this.raw('monthly_leaderboards', { month, year }))[0];
    const pid = period ? idOf(period._id) : '';
    const entries = pid ? await this.raw('leaderboard_entries', { leaderboardId: { $oid: pid } }) : [];
    const ledger = await this.raw('reward_point_transactions');
    const wallets = await this.raw('user_reward_points');
    const badges = await this.raw('badges');
    const audit = await this.raw('leaderboard_audit_logs');
    const body = JSON.stringify({
      period: period && {
        status: period.status, totalParticipants: num(period.totalParticipants), totalPointsAwarded: num(period.totalPointsAwarded),
        policyVersion: period.policyVersion, hasFinalizedAt: !!period.finalizedAt, month: num(period.month), year: num(period.year),
      },
      entries: entries
        .map((e) => ({
          user: idOf(e.userId), rank: num(e.rank), isTie: e.isTie, points: e.points, completedCourses: num(e.completedCourses),
          averageScore: e.averageScore ?? null, lastCompletedAt: e.lastCompletedAt, rewardPoints: num(e.rewardPoints), scoreBreakdown: e.scoreBreakdown,
          rewardBadgeLinked: !!e.rewardBadgeId, notified: !!e.rewardNotifiedAt, notifyError: e.rewardNotifyError ?? null, claimLeft: !!e.rewardNotifyClaimToken,
        }))
        .sort((a, b) => a.user.localeCompare(b.user)),
      ledger: ledger
        .map((t) => ({
          user: idOf(t.userId), type: t.type, amount: num(t.amount), balanceAfter: num(t.balanceAfter), sourceIsPeriod: idOf(t.sourceId) === pid,
          key: t.idempotencyKey, description: t.description, metadata: t.metadata,
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      wallets: wallets.map((w) => ({ user: idOf(w.userId), balance: num(w.balance), totalEarned: num(w.totalEarned), totalSpent: num(w.totalSpent) })).sort((a, b) => a.user.localeCompare(b.user)),
      badges: badges
        .map((b) => ({ user: idOf(b.userId), name: b.badgeName, type: b.badgeType, description: b.description, icon: b.iconUrl ?? null, metadata: b.metadata }))
        .sort((a, b) => (a.user + a.name).localeCompare(b.user + b.name)),
      audit: audit
        .map((a) => ({ action: a.action, target: a.targetUserId ? idOf(a.targetUserId) : null, month: num(a.month), year: num(a.year), reason: a.reason, details: a.details }))
        .sort((a, b) => (a.action + (a.target || '')).localeCompare(b.action + (b.target || ''))),
    });
    // every document id is operational: replace them (mongo _ids of the period, entries, ledger entries, badges, audit rows)
    const ids = new Set<string>([pid, ...entries.map((e) => idOf(e._id)), ...ledger.map((t) => idOf(t._id)), ...badges.map((b) => idOf(b._id)), ...audit.map((a) => idOf(a._id))]);
    let out = body;
    for (const id of ids) if (id) out = out.split(id).join('<id>');
    return out;
  }

  async summary(month: number, year: number): Promise<string> {
    const period = (await this.raw('monthly_leaderboards', { month, year }))[0];
    const pid = period?._id?.$oid;
    const entries = pid ? await this.raw('leaderboard_entries', { leaderboardId: { $oid: pid } }) : [];
    const ledger = await this.raw('reward_point_transactions', { type: 'LEADERBOARD_REWARD', 'metadata.month': month, 'metadata.year': year });
    const wallets = await this.raw('user_reward_points');
    const badges = await this.raw('badges', { badgeType: 'LEADERBOARD_REWARD' });
    const audit = await this.raw('leaderboard_audit_logs');
    return JSON.stringify({
      period: period && {
        status: period.status,
        totalParticipants: num(period.totalParticipants),
        totalPointsAwarded: num(period.totalPointsAwarded),
        policyVersion: period.policyVersion,
        hasFinalizedAt: !!period.finalizedAt,
        locked: !!period.lockToken,
      },
      entries: entries
        .map((e) => [idOf(e.userId), num(e.rank), e.isTie, num(e.points), num(e.completedCourses), e.averageScore === undefined ? null : e.averageScore, num(e.rewardPoints), !!e.rewardBadgeId, !!e.rewardNotifiedAt])
        .sort(),
      ledger: ledger.map((t) => [idOf(t.userId), num(t.amount), t.idempotencyKey, idOf(t.sourceId) === pid]).sort(),
      wallets: wallets.map((w) => [idOf(w.userId), num(w.balance), num(w.totalEarned), num(w.totalSpent)]).sort(),
      badges: badges.map((b) => [idOf(b.userId), b.badgeName]).sort(),
      audit: audit.map((a) => a.action).sort(),
    });
  }
}
