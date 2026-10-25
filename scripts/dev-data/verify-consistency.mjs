#!/usr/bin/env node
/**
 * Read-only check of the DATA-01 records across auth_db, user_db and course_db:
 * account <-> profile userId links, explicit roles, course owner = a verified INSTRUCTOR, category, valid moderation status
 * combination (APPROVED = published + approvedBy the verified ADMIN), aggregates still 0, lessons 0..n-1 of an existing course,
 * positive durations, no unserved videoUrl, no orphan lesson.
 *
 *   node scripts/dev-data/verify-consistency.mjs [--target=docker|local] [--complete]
 *   --complete: records of the fixtures that do not exist yet count as errors (use after --apply)
 * Exit 0 = consistent, 1 = errors, 2 = databases unreadable.
 */
import { runVerify, StopError } from './lib/seed.mjs';

const args = process.argv.slice(2);
const target = (args.find((a) => a.startsWith('--target=')) || '--target=docker').split('=')[1];
const expectComplete = args.includes('--complete');

try {
  const { summary, consistency } = await runVerify({ target, expectComplete });
  console.log(`present: ${JSON.stringify(consistency.counts)}`);
  console.log(`not created yet: ${consistency.missing.length}   missing unique indexes: ${summary.missingIndexes.length}   orphan lessons: ${summary.orphanLessons}`);
  if (consistency.errors.length) {
    console.log(`${consistency.errors.length} error(s):`);
    for (const e of consistency.errors) console.log(`  ! ${e}`);
    process.exit(1);
  }
  console.log('consistent');
} catch (e) {
  if (e instanceof StopError) {
    console.error(`STOP: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
