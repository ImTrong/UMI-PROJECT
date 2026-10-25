// Runs one part (parts/<service>.cjs) with the Prisma client of that service, the same way scripts/demo-seed does:
//   docker (default): `docker exec -i elearning-<service> node -` - the container's own client and DATABASE_URL, so no
//                      connection string ever leaves Docker;
//   local:            `node -` with cwd services/<service> (its generated client) and DATABASE_URL from DEV_DATA_<SVC>_DB_URL -
//                      only for an isolated database (tests). Port 27017 (the Docker MongoDB published on the host) is refused.
// The part receives `const INPUT = {...};` in front of its source and answers with one line `RESULT:<json>`.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARTS = path.join(HERE, '..', 'parts');
const REPO = path.join(HERE, '..', '..', '..');

export const SERVICES = {
  auth: { container: 'elearning-auth-service', dir: 'auth-service', env: 'DEV_DATA_AUTH_DB_URL' },
  user: { container: 'elearning-user-service', dir: 'user-service', env: 'DEV_DATA_USER_DB_URL' },
  course: { container: 'elearning-course-service', dir: 'course-service', env: 'DEV_DATA_COURSE_DB_URL' },
};

export class PartError extends Error {
  constructor(service, message) {
    super(`${service}: ${message}`);
    this.name = 'PartError';
    this.service = service;
  }
}

/** The local target must never be pointed at the shared Docker database. */
export function assertIsolatedUrl(url, service) {
  if (!url) throw new PartError(service, `local target needs ${SERVICES[service].env}`);
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new PartError(service, 'local database URL is not a valid URL');
  }
  if (u.protocol !== 'mongodb:') throw new PartError(service, 'local database URL must be mongodb://');
  if (!u.port || u.port === '27017') throw new PartError(service, 'local target refuses port 27017 (the Docker MongoDB); use an isolated mongod');
}

function spawnPart(service, input, { target = 'docker', env = process.env, timeoutMs = 120_000 } = {}) {
  const svc = SERVICES[service];
  if (!svc) throw new PartError(service, 'unknown service');
  const source = readFileSync(path.join(PARTS, `${service}.cjs`), 'utf8');
  const stdin = `const INPUT = ${JSON.stringify(input)};\n${source}`;
  let cmd;
  let args;
  let opts;
  if (target === 'docker') {
    cmd = 'docker';
    args = ['exec', '-i', svc.container, 'node', '-'];
    opts = { env: { ...process.env } };
  } else if (target === 'local') {
    const url = env[svc.env];
    assertIsolatedUrl(url, service);
    cmd = process.execPath;
    args = ['-'];
    opts = { cwd: path.join(REPO, 'services', svc.dir), env: { ...process.env, DATABASE_URL: url, BCRYPT_ROUNDS: env.BCRYPT_ROUNDS || process.env.BCRYPT_ROUNDS || '10' } };
  } else {
    throw new PartError(service, `unknown target ${target}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let errText = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new PartError(service, `no answer within ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errText += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new PartError(service, `cannot start: ${e.code || e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out.split('\n').reverse().find((l) => l.startsWith('RESULT:'));
      if (!line) {
        // stderr may hold a Prisma error with the connection string: only its last line, with any URL masked
        const tail = errText.trim().split('\n').slice(-1)[0] || '';
        return reject(new PartError(service, `no result (exit ${code}): ${tail.replace(/mongodb(\+srv)?:\/\/\S+/g, 'mongodb://***').slice(0, 300)}`));
      }
      let result;
      try {
        result = JSON.parse(line.slice('RESULT:'.length));
      } catch {
        return reject(new PartError(service, 'unreadable result'));
      }
      if (result.error) return reject(new PartError(service, result.error));
      resolve(result);
    });
    child.stdin.end(stdin);
  });
}

export function runPart(service, input, options) {
  return spawnPart(service, input, options);
}
