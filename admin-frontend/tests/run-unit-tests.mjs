/**
 * Minimal unit-test runner for the admin frontend (FIX DEMO RANKING 02A), same approach as frontend/tests/run-unit-tests.mjs:
 * the project has no test framework, so no dependency is added. Each tests/*.test.ts(x) file is bundled with the esbuild that
 * ships with Vite (TypeScript + JSX, `import.meta.env` defined as in a test build, npm packages left external) into
 * node_modules/.cache/unit-tests and run with Node's built-in test runner.
 *
 *   node tests/run-unit-tests.mjs
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'node_modules', '.cache', 'unit-tests');   // inside node_modules: never committed
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const entries = readdirSync(path.join(root, 'tests')).filter((f) => /\.test\.tsx?$/.test(f)).map((f) => path.join(root, 'tests', f));
await build({
  entryPoints: entries,
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  jsx: 'automatic',
  packages: 'external',
  outExtension: { '.js': '.mjs' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: false, VITE_API_GATEWAY_URL: 'http://127.0.0.1:9' }) },
  logLevel: 'warning',
});

const files = readdirSync(outdir).filter((f) => f.endsWith('.mjs')).map((f) => path.join(outdir, f));
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(run.status ?? 1);
