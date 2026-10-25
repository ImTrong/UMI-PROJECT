#!/usr/bin/env node
/**
 * DATA-01 - development data: accounts, profiles, categories, courses, lessons (synthetic, @umi-demo.local).
 *
 *   node scripts/dev-data/seed-dev-data.mjs              dry run (default): reads, compares with the fixtures, writes nothing
 *   node scripts/dev-data/seed-dev-data.mjs --apply      creates the missing records, then verifies them
 *   options: --target=docker (default: runs each part inside its elearning-* container, like scripts/demo-seed)
 *            --target=local  (isolated database only: DEV_DATA_AUTH_DB_URL / DEV_DATA_USER_DB_URL / DEV_DATA_COURSE_DB_URL)
 *            --json          print the machine-readable result
 *
 * Exit codes: 0 done / nothing to do, 2 stopped (invalid fixtures, missing unique index, unreadable database, credentials file
 * problem), 3 finished with conflicts or blocked records (those records were left alone), 1 consistency errors after apply.
 * Never deletes or updates anything. Generated passwords go only to scripts/dev-data/.accounts.local.json (git-ignored).
 */
import { runSeed, StopError } from './lib/seed.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const target = (args.find((a) => a.startsWith('--target=')) || '--target=docker').split('=')[1];
const unknown = args.filter((a) => !['--apply', '--json'].includes(a) && !a.startsWith('--target='));
if (unknown.length) {
  console.error(`unknown option(s): ${unknown.join(' ')}`);
  process.exit(2);
}

function print(res) {
  const s = res.summary;
  console.log(`Mode: ${res.mode === 'apply' ? 'APPLY' : 'DRY RUN (no writes)'}  target=${target}`);
  console.log(`  accounts   ${JSON.stringify(s.accounts)}`);
  console.log(`  profiles   ${JSON.stringify(s.profiles)}  rows ${JSON.stringify(s.profileRows)}`);
  console.log(`  categories ${JSON.stringify(s.categories)}`);
  console.log(`  courses    ${JSON.stringify(s.courses)}`);
  console.log(`  lessons    ${JSON.stringify(s.lessons)}`);
  console.log(`  data outside DATA-01 unchanged: ${s.othersUnchanged}   orphan lessons: ${s.orphanLessons}`);
  if (s.missingIndexes.length) console.log(`  missing unique indexes (apply is refused until the schema sync has run):\n    - ${s.missingIndexes.join('\n    - ')}`);
  if (s.conflicts.length) console.log(`  CONFLICTS (left untouched):\n    - ${s.conflicts.join('\n    - ')}`);
  if (s.blocked.length) console.log(`  blocked:\n    - ${s.blocked.join('\n    - ')}`);
  const c = res.consistency;
  console.log(`  consistency: ${c.errors.length} error(s), ${c.missing.length} record(s) not created yet`);
  for (const e of c.errors.slice(0, 30)) console.log(`    ! ${e}`);
  if (res.mode === 'dry-run') console.log('\nDry run finished: nothing was written. Re-run with --apply to create the missing records.');
}

try {
  const res = await runSeed({ apply, target, log: (m) => console.log(`  ${m}`) });
  if (json) console.log(JSON.stringify({ mode: res.mode, summary: res.summary, consistency: res.consistency, applied: res.applied }, null, 2));
  else print(res);
  if (res.mode === 'apply' && res.consistency.errors.length) process.exit(1);
  if (res.summary.conflicts.length || res.summary.blocked.length) process.exit(3);
  process.exit(0);
} catch (e) {
  if (e instanceof StopError) {
    console.error(`\nSTOP: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
