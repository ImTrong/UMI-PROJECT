/**
 * SCOPE-RESET-01 (frontend):
 *   - the role stored at login follows the server: when App.tsx's profile fetch (user/fetchProfile) answers another role - e.g. an
 *     ADMIN approved the instructor application - the stored role is replaced (no new login needed);
 *   - the learner's payment history offers no self-refund button (refunds are started by an ADMIN only).
 *
 * Run: npm test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

const authReducer = require('../src/store/authSlice').default;
const { PaymentCard } = require('../src/components/payment/PaymentCard');

const fetched = (payload: unknown) => ({ type: 'user/fetchProfile/fulfilled', payload });
const loggedIn = (role: string) => ({ user: { id: 'u1', email: 'learner@umi.test', fullName: 'Learner', role }, isAuthenticated: true, loading: false, error: null });

describe('SCOPE-RESET-01: role sync and no learner self-refund', () => {
  beforeEach(() => store.clear());

  it('an approved applicant becomes INSTRUCTOR on the next profile fetch, and the stored user follows', () => {
    const next = authReducer(loggedIn('STUDENT'), fetched({ role: 'INSTRUCTOR' }));
    assert.equal(next.user.role, 'INSTRUCTOR');
    assert.equal(JSON.parse(store.get('user')!).role, 'INSTRUCTOR');
    // a role taken away is followed as well
    assert.equal(authReducer(loggedIn('INSTRUCTOR'), fetched({ role: 'STUDENT' })).user.role, 'STUDENT');
  });

  it('nothing changes for the same role, an unknown value, a missing role or a signed-out state', () => {
    const same = authReducer(loggedIn('STUDENT'), fetched({ role: 'STUDENT' }));
    assert.equal(same.user.role, 'STUDENT');
    assert.equal(store.size, 0, 'nothing rewritten');
    for (const payload of [{ role: 'SUPERADMIN' }, {}, null]) {
      assert.equal(authReducer(loggedIn('STUDENT'), fetched(payload)).user.role, 'STUDENT', JSON.stringify(payload));
    }
    assert.equal(authReducer({ ...loggedIn('STUDENT'), user: null, isAuthenticated: false }, fetched({ role: 'ADMIN' })).user, null);
  });

  it('the payment history renders no refund button and never calls the refund API', () => {
    const payment = { id: 'p1', amount: 500000, currency: 'vnd', status: 'SUCCEEDED', provider: 'payos', type: 'COURSE_PURCHASE', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const html = renderToStaticMarkup(<PaymentCard payment={payment as any} />);
    assert.doesNotMatch(html, /hoàn tiền/i);
    const page = readFileSync(path.join(process.cwd(), 'src', 'pages', 'Payments.tsx'), 'utf8');
    assert.doesNotMatch(page, /refundPayment|onRefund|handleRefund/);
  });
});
