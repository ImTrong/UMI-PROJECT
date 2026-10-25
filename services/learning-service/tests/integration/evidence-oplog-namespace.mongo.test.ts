/**
 * Harness check (FIX 07B-1.2): the oplog evidence of the multi-process suites only reads entries of ITS OWN database.
 *
 * Other suites share the replica set (and its oplog). An index created there with a partial filter `{ field: { $type: 'string' } }`
 * is logged with a `$type` key that this Prisma client cannot decode ("Unknown tagged value"); before the fix one such foreign entry
 * made every oplog read of a running multi-process test fail. Here a neighbouring database (whose name even starts with ours) writes
 * exactly that, before and after the marker, and the evidence must neither fail nor report a write that is not ours.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Evidence } from '../helpers/mp/evidence';

function resolve(suffix: string): { enabled: boolean; url?: string; dbName: string } {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return { enabled: false, dbName: '' };
  const [base, query] = raw.split('?');
  const name = base.split('/').pop() || '';
  if (!/test/i.test(name)) return { enabled: false, dbName: name };
  const dbName = `${name}_${suffix}`;
  return { enabled: true, url: `${base.slice(0, base.length - name.length)}${dbName}${query ? `?${query}` : ''}`, dbName };
}

const own = resolve('evns');
const neighbour = resolve('evns2');   // "<name>_evns2" - starts with "<name>_evns", must still not count as ours

describe('oplog evidence is limited to its own database (harness, FIX 07B-1.2)', { skip: own.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let mine: any;
  let other: any;
  let local: any;
  let ev: Evidence;
  const foreignIndex = (name: string) => other.$runCommandRaw({
    createIndexes: 'payments',
    indexes: [{ key: { [name]: 1 }, name: `${name}_partial`, unique: true, partialFilterExpression: { [name]: { $type: 'string' } } }],
  });

  before(async () => {
    const { PrismaClient } = require('@prisma/client');
    mine = new PrismaClient({ datasources: { db: { url: own.url } } });
    other = new PrismaClient({ datasources: { db: { url: neighbour.url } } });
    local = new PrismaClient({ datasources: { db: { url: (own.url as string).replace(/\/[^/?]+\?/, '/local?') } } });
    await mine.$runCommandRaw({ dropDatabase: 1 });
    await other.$runCommandRaw({ dropDatabase: 1 });
    ev = new Evidence(mine, local, own.dbName);
  });

  after(async () => {
    for (const c of [mine, other]) { try { await c.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ } }
    for (const c of [mine, other, local]) await c?.$disconnect();
  });

  it('a foreign `$type` entry as the newest oplog entry does not break the marker; foreign writes after it are not reported', async () => {
    await foreignIndex('payosOrderCode');                       // newest oplog entry now carries `$type`
    const marker = await ev.oplogMarker();
    await mine.$runCommandRaw({ insert: 'monthly_leaderboards', documents: [{ month: 9, year: 2026, status: 'ACTIVE' }] });
    await foreignIndex('stripePaymentIntentId');
    await other.$runCommandRaw({ insert: 'monthly_leaderboards', documents: [{ month: 9, year: 2026, status: 'FINALIZED' }] });
    await mine.$runCommandRaw({ update: 'monthly_leaderboards', updates: [{ q: { month: 9 }, u: { $set: { status: 'SNAPSHOT_BUILDING' } } }] });

    const writes = await ev.writesSince(marker);
    assert.deepEqual(writes.map((w) => [w.op, w.coll]), [['i', 'monthly_leaderboards'], ['u', 'monthly_leaderboards']]);
    assert.deepEqual(Evidence.statusSequence(writes), ['ACTIVE', 'SNAPSHOT_BUILDING'], 'the neighbour\'s FINALIZED is not ours');
  });
});
