/**
 * Resolves the isolated MongoDB replica-set database used by integration tests (same rules as the learning service).
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest"
 *
 * - the database name must contain "test" (refuses anything else, e.g. a dev / prod database)
 * - every integration FILE gets its own database (`<name>_<suffix>`) because `node --test` runs files in parallel
 *   and they must not wipe each other's data
 */
export function resolveTestDb(suffix: string): { enabled: boolean; url?: string; dbName: string } {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return { enabled: false, dbName: '' };

  const [base, query] = raw.split('?');
  const name = base.split('/').pop() || '';
  if (!/test/i.test(name)) {
    console.error(`Refusing to run integration tests: database "${name}" does not look like a test database.`);
    return { enabled: false, dbName: name };
  }
  const dbName = `${name}_${suffix}`;
  const url = `${base.slice(0, base.length - name.length)}${dbName}${query ? `?${query}` : ''}`;
  return { enabled: true, url, dbName };
}
