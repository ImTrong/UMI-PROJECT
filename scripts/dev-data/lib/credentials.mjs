// Local, git-ignored file with the generated demo passwords (scripts/dev-data/.accounts.local.json).
// It is created once, with exclusive-create ('wx'), BEFORE any account is created - so a created account never has an
// unknown password - and it is never overwritten. Passwords are never printed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CREDENTIALS_FILE = path.join(HERE, '..', '.accounts.local.json');

export const credentialsFile = (env = process.env) => env.DEV_DATA_CREDENTIALS_FILE || DEFAULT_CREDENTIALS_FILE;

export const generatePassword = () => randomBytes(18).toString('base64url'); // 24 characters, 144 bits

export function readCredentials(file) {
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.accounts)) throw new Error(`${path.basename(file)} is not a credentials file of this tool`);
  return new Map(parsed.accounts.map((a) => [a.email, a.password]));
}

/**
 * Passwords for the accounts that are about to be created.
 *   - no file yet: generate one per account to create and write the file (exclusive create);
 *   - file present: use its passwords; if one is missing, stop - the file is not modified.
 */
export function passwordsFor(toCreate, file, { dataset }) {
  if (toCreate.length === 0) return new Map();
  const existing = readCredentials(file);
  if (existing) {
    const missing = toCreate.filter((a) => !existing.get(a.email) || existing.get(a.email).length < 16);
    if (missing.length > 0) {
      throw new Error(`${path.basename(file)} already exists and has no password for ${missing.length} account(s) to create (${missing.map((a) => a.key).join(', ')}); it is not overwritten - move it away or add the entries yourself`);
    }
    return new Map(toCreate.map((a) => [a.email, existing.get(a.email)]));
  }
  const accounts = toCreate.map((a) => ({ key: a.key, role: a.role, email: a.email, password: generatePassword() }));
  const body = {
    dataset,
    note: 'UMI development accounts (synthetic). LOCAL ONLY - git-ignored. Do not commit or share.',
    createdAt: new Date().toISOString(),
    accounts,
  };
  writeFileSync(file, JSON.stringify(body, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return new Map(accounts.map((a) => [a.email, a.password]));
}
