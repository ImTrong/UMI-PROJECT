/**
 * FIX-INS-07: withAccessToken adds the signed-in user's token ONLY to course-service download URLs (paid lesson videos /
 * documents, which <video> and the PDF viewer cannot request with an Authorization header). Public / external / blob URLs and
 * the anonymous case are left exactly as they are.
 *
 *   node tests/run-unit-tests.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withAccessToken } from '../src/utils/protected-file-url';

const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};

describe('withAccessToken (FIX-INS-07)', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it('appends the encoded token to /api/courses/files/download URLs', () => {
    store.accessToken = 'a.b+c/d=';
    assert.equal(withAccessToken('/api/courses/files/download?bucket=courses&key=k.mp4'), '/api/courses/files/download?bucket=courses&key=k.mp4&token=a.b%2Bc%2Fd%3D');
    assert.equal(withAccessToken('/api/courses/files/download'), '/api/courses/files/download?token=a.b%2Bc%2Fd%3D');
  });

  it('FIX-INS-08: also appends it to /api/learning/files/download URLs (submission files opened through <a href>)', () => {
    store.accessToken = 'tok';
    assert.equal(withAccessToken('/api/learning/files/download?bucket=assignments&key=x.zip'), '/api/learning/files/download?bucket=assignments&key=x.zip&token=tok');
  });

  it('leaves every other URL untouched (no token ever leaks to an external host or another route)', () => {
    store.accessToken = 'secret-token';
    for (const url of ['https://cdn.example.test/v.mp4', 'blob:http://localhost/abc', '/uploads/x.png', 'https://evil.test/api/courses/files/download?key=x', '/api/learning/progress/me']) {
      assert.equal(withAccessToken(url), url);
    }
    assert.equal(withAccessToken(null), '');
    assert.equal(withAccessToken(undefined), '');
  });

  it('without a signed-in user the URL is unchanged (public previews still load)', () => {
    assert.equal(withAccessToken('/api/courses/files/download?bucket=courses&key=p.mp4'), '/api/courses/files/download?bucket=courses&key=p.mp4');
  });
});
