/**
 * The learning-path demo seed (prisma/seed-paths.ts) must never destroy data:
 *   - docker-compose does not run it when the learning-service starts;
 *   - run by hand it writes only into an EMPTY database (no learning path AND no final project), never deletes / overwrites;
 *   - if the "is it empty?" check fails it stops (exit code 2) without writing - a failed query is never read as "empty".
 * Runs against in-memory fakes: no database, no course-service, nothing is seeded for real.
 *
 * Run: npm test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installFakePrisma } from './helpers/fake-prisma';

installFakePrisma();   // the module builds a PrismaClient at import time - never a real one here
const { seedLearningPaths } = require('../prisma/seed-paths.ts');   // the TS source (a legacy seed-paths.js sits next to it)

type Call = { model: string; op: string };
const makeClient = (counts: { paths: number | (() => Promise<number>); projects: number | (() => Promise<number>) }) => {
  const calls: Call[] = [];
  const model = (name: 'learningPath' | 'finalProject') => ({
    count: async () => {
      calls.push({ model: name, op: 'count' });
      const c = name === 'learningPath' ? counts.paths : counts.projects;
      return typeof c === 'function' ? c() : c;
    },
    create: async ({ data }: any) => { calls.push({ model: name, op: 'create' }); return { id: `${name}-${calls.length}`, ...data }; },
    deleteMany: async () => { calls.push({ model: name, op: 'deleteMany' }); return { count: 0 }; },
    delete: async () => { calls.push({ model: name, op: 'delete' }); return {}; },
    update: async () => { calls.push({ model: name, op: 'update' }); return {}; },
    updateMany: async () => { calls.push({ model: name, op: 'updateMany' }); return {}; },
    upsert: async () => { calls.push({ model: name, op: 'upsert' }); return {}; },
  });
  return { client: { learningPath: model('learningPath'), finalProject: model('finalProject') }, calls };
};
const writes = (calls: Call[]) => calls.filter((c) => c.op !== 'count');
let httpCalls = 0;
const http = { get: async () => { httpCalls++; return { data: { courses: [{ id: 'c'.repeat(24), title: 'React JavaScript Node.js Python SQL' }] } }; } };

describe('learning-path seed: never destructive', () => {
  beforeEach(() => { httpCalls = 0; });

  it('a failed check (count throws / returns garbage) stops the seed: CHECK_FAILED, nothing written, course-service not even called', async () => {
    for (const bad of [
      { paths: () => Promise.reject(new Error('Server selection timeout')), projects: 0 },
      { paths: 0, projects: () => Promise.reject(new Error('auth failed')) },
      { paths: () => Promise.resolve(undefined as any), projects: 0 },
      { paths: () => Promise.resolve(NaN), projects: 0 },
    ]) {
      const { client, calls } = makeClient(bad as any);
      const outcome = await seedLearningPaths(client, http);
      assert.equal(outcome.status, 'CHECK_FAILED');
      assert.deepEqual(writes(calls), []);
    }
    assert.equal(httpCalls, 0);
  });

  it('existing learning paths and/or final projects: nothing deleted, overwritten or added', async () => {
    for (const counts of [{ paths: 60, projects: 60 }, { paths: 1, projects: 0 }, { paths: 0, projects: 3 }]) {
      const { client, calls } = makeClient(counts);
      const outcome = await seedLearningPaths(client, http);
      assert.equal(outcome.status, 'SKIPPED_EXISTING', JSON.stringify(counts));
      assert.deepEqual(writes(calls), [], JSON.stringify(counts));
    }
    assert.equal(httpCalls, 0);
  });

  it('an empty database is seeded with creates only (no deleteMany / update / upsert)', async () => {
    const { client, calls } = makeClient({ paths: 0, projects: 0 });
    const outcome = await seedLearningPaths(client, http);
    assert.equal(outcome.status, 'SEEDED');
    assert.ok(outcome.paths > 0 && outcome.projects === outcome.paths);
    assert.ok(writes(calls).length > 0);
    assert.deepEqual([...new Set(writes(calls).map((c) => c.op))], ['create']);
  });

  it('the seed source holds no destructive call and does not run on import', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../prisma/seed-paths.ts'), 'utf8');
    assert.doesNotMatch(src, /\.(deleteMany|delete|update|updateMany|upsert)\s*\(/);
    assert.match(src, /if \(require\.main === module\)/);
    assert.match(src, /'CHECK_FAILED' \? 2 : 0/, 'a failed check exits non-zero');
  });

  it('the legacy prisma/seed-paths.js is create-only too: no delete, its upserts never overwrite an existing path', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../prisma/seed-paths.js'), 'utf8');
    assert.doesNotMatch(src, /\.(deleteMany|delete|update|updateMany)\s*\(/);
    const upserts = src.match(/\.upsert\(/g) || [];
    const emptyUpdates = src.match(/update:\s*\{\s*\}/g) || [];
    assert.equal(emptyUpdates.length, upserts.length);
  });

  it('docker-compose no longer runs the seed (nor, since DEPLOY-PRE-01, prisma db push) when a service starts', () => {
    const compose = fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').replace(/\r\n/g, '\n');
    const commands = compose.split('\n').filter((l) => /^\s+command:/.test(l));
    assert.ok(commands.length > 0);
    for (const c of commands) assert.doesNotMatch(c, /seed-paths/, c.trim());
    const block = compose.slice(compose.indexOf('\n  learning-service:'), compose.indexOf('\n  ai-service:'));
    const cmd = block.split('\n').find((l) => /^\s+command:/.test(l))!;
    assert.match(cmd, /command: sh -c "node dist\/index\.js"$/);
    for (const c of commands) assert.doesNotMatch(c, /seed|prisma db push|migrate|learningPath\.count|deleteMany/, c.trim());
  });
});
