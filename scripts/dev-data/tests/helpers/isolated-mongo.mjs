// Isolated MongoDB for the DATA-01 integration tests: a throw-away single-node replica set on 127.0.0.1:<port> with its data in
// a fresh temp directory. Never the Docker MongoDB (27017). Commands go through a service's own Prisma client ($runCommandRaw),
// because no MongoDB driver or mongosh is installed locally.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.join(HERE, '..', '..', '..', '..');
const MONGOD = process.env.DEV_DATA_TEST_MONGOD || 'C:/Program Files/MongoDB/Server/7.0/bin/mongod.exe';

export const url = (port, db, extra = '') => `mongodb://127.0.0.1:${port}/${db}?directConnection=true&serverSelectionTimeoutMS=5000${extra}`;

function runNode(cwd, script, env, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-'], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const t = setTimeout(() => { child.kill(); reject(new Error('node helper timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(t);
      const line = out.split('\n').reverse().find((l) => l.startsWith('RESULT:'));
      if (!line) return reject(new Error(`helper failed (exit ${code}): ${err.slice(-400)}`));
      resolve(JSON.parse(line.slice(7)));
    });
    child.stdin.end(script);
  });
}

/** Run raw commands against `dbUrl` (EJSON accepted: {$oid}, {$date}). Each answer is {ok, r} or {ok:false, e}. */
export function raw(dbUrl, commands) {
  const script = `const INPUT = ${JSON.stringify({ commands })};
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const res = [];
  for (const c of INPUT.commands) {
    try { res.push({ ok: true, r: await p.$runCommandRaw(c) }); } catch (e) { res.push({ ok: false, e: String(e.message).slice(-300) }); }
  }
  console.log('RESULT:' + JSON.stringify(res));
  await p.$disconnect().catch(() => {});
})();`;
  return runNode(path.join(REPO, 'services', 'course-service'), script, { DATABASE_URL: dbUrl });
}

export async function rawOne(dbUrl, command) {
  const [res] = await raw(dbUrl, [command]);
  if (!res.ok) throw new Error(res.e);
  return res.r;
}

/** All documents of a collection (read-only, test inspection). */
export async function findAll(dbUrl, collection, filter = {}) {
  const r = await rawOne(dbUrl, { find: collection, filter, batchSize: 10000 });
  return r.cursor.firstBatch;
}

export async function count(dbUrl, collection, query = {}) {
  return (await rawOne(dbUrl, { count: collection, query })).n;
}

/** md5 per collection of a database (read-only). */
export async function dbHash(dbUrl) {
  const r = await rawOne(dbUrl, { dbHash: 1 });
  return r.collections || {};
}

export async function startMongod(port) {
  const dir = mkdtempSync(path.join(tmpdir(), 'umi-data01-'));
  const child = spawn(MONGOD, ['--dbpath', dir, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'rsData01', '--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128', '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('mongod did not start')), 60_000);
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`mongod exited ${code}`)); });
    child.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('Waiting for connections')) { clearTimeout(t); resolve(); }
    });
  });
  child.stdout.removeAllListeners('data');
  child.stdout.resume();
  const admin = url(port, 'admin');
  await raw(admin, [{ replSetInitiate: { _id: 'rsData01', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } }]);
  for (let i = 0; i < 60; i++) {
    const [h] = await raw(admin, [{ hello: 1 }]);
    if (h.ok && h.r.isWritablePrimary) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return {
    port,
    dir,
    async stop() {
      await raw(admin, [{ shutdown: 1, force: true }]).catch(() => {});
      await new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); setTimeout(() => { child.kill(); r(); }, 15_000); });
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    },
  };
}

/** `prisma db push` of one service's schema into an ISOLATED test database (never the Docker one). */
export function dbPush(service, dbUrl) {
  if (/:27017\//.test(dbUrl)) throw new Error('refusing to push to port 27017');
  return new Promise((resolve, reject) => {
    const cwd = path.join(REPO, 'services', service);
    const cli = path.join(cwd, 'node_modules', 'prisma', 'build', 'index.js');
    const child = spawn(process.execPath, [cli, 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], { cwd, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`db push ${service} failed: ${out.slice(-400)}`))));
  });
}
