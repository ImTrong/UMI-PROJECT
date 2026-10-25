// Credentials file and target guards (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { passwordsFor, readCredentials } from '../lib/credentials.mjs';
import { assertIsolatedUrl } from '../lib/runner.mjs';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'umi-data01-cred-'));
const acc = (n) => Array.from({ length: n }, (_, i) => ({ key: `K${i}`, role: 'STUDENT', email: `k${i}@umi-demo.local` }));

test('a new credentials file is written once, with unique random passwords', () => {
  const dir = tmp();
  const file = path.join(dir, '.accounts.local.json');
  const pw = passwordsFor(acc(5), file, { dataset: 'DATA-01' });
  assert.equal(pw.size, 5);
  assert.equal(new Set(pw.values()).size, 5);
  for (const p of pw.values()) assert.ok(p.length >= 20);
  const stored = readCredentials(file);
  assert.deepEqual([...stored.entries()], [...pw.entries()]);
  rmSync(dir, { recursive: true, force: true });
});

test('an existing credentials file is reused and never overwritten', () => {
  const dir = tmp();
  const file = path.join(dir, '.accounts.local.json');
  passwordsFor(acc(3), file, { dataset: 'DATA-01' });
  const before = readFileSync(file, 'utf8');
  const again = passwordsFor(acc(3), file, { dataset: 'DATA-01' });
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.deepEqual([...again.values()], [...readCredentials(file).values()]);
  // an account that is not in the file: stop, file untouched
  assert.throws(() => passwordsFor(acc(4), file, { dataset: 'DATA-01' }), /already exists and has no password for 1 account/);
  assert.equal(readFileSync(file, 'utf8'), before);
  rmSync(dir, { recursive: true, force: true });
});

test('nothing to create: no file is written', () => {
  const dir = tmp();
  const file = path.join(dir, '.accounts.local.json');
  assert.equal(passwordsFor([], file, { dataset: 'DATA-01' }).size, 0);
  assert.equal(existsSync(file), false);
  rmSync(dir, { recursive: true, force: true });
});

test('a foreign file at the credentials path is refused, not replaced', () => {
  const dir = tmp();
  const file = path.join(dir, '.accounts.local.json');
  writeFileSync(file, '{"something":"else"}');
  assert.throws(() => passwordsFor(acc(1), file, { dataset: 'DATA-01' }), /not a credentials file/);
  assert.equal(readFileSync(file, 'utf8'), '{"something":"else"}');
  rmSync(dir, { recursive: true, force: true });
});

test('the local target refuses the Docker MongoDB port and malformed URLs', () => {
  assert.throws(() => assertIsolatedUrl('mongodb://localhost:27017/auth_db', 'auth'), /refuses port 27017/);
  assert.throws(() => assertIsolatedUrl('mongodb://admin:x@localhost/auth_db', 'auth'), /refuses port 27017/);
  assert.throws(() => assertIsolatedUrl(undefined, 'auth'), /needs DEV_DATA_AUTH_DB_URL/);
  assert.throws(() => assertIsolatedUrl('postgres://127.0.0.1:5432/x', 'auth'), /mongodb/);
  assert.doesNotThrow(() => assertIsolatedUrl('mongodb://127.0.0.1:27098/auth_db?directConnection=true', 'auth'));
});

test('no part or library contains a delete / drop / update / upsert call', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const dir of ['parts', 'lib']) {
    for (const f of readdirSync(path.join(root, dir))) {
      const src = readFileSync(path.join(root, dir, f), 'utf8');
      // prisma.<model>.<write>( - crypto's createHash(...).update( is a hash, not a database write
      assert.doesNotMatch(src, /\.\w+\.(deleteMany|delete|update|updateMany|upsert)\(|dropDatabase|\bdrop\s*:|deleteOne|replaceOne|\bupdate\s*:\s*'/, `${dir}/${f}`);
    }
  }
});
