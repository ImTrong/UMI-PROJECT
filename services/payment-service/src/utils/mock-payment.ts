import { Request, Response, NextFunction } from 'express';

/**
 * Demo / sandbox payment completion ("mock-complete") - FIX 07B-1.
 *
 * Marking a payment SUCCEEDED without a payment provider is only acceptable in a controlled development or test environment:
 *   - it is OFF unless PAYMENT_MOCK_ENABLED is exactly "true" (unset, empty, "false", "TRUE", "1" ... are all OFF);
 *   - it is ALWAYS off when NODE_ENV is production, whatever PAYMENT_MOCK_ENABLED says.
 * Both the route (requireMockPaymentEnabled) and the service method (assertMockPaymentEnabled) check it, so calling the
 * service directly cannot skip the flag. PaymentService.confirmPayment applies the same rule to a payment without a real
 * Stripe intent (Stripe not configured, metadata.isMock, pi_mock_ id), which it would otherwise mark SUCCEEDED for free.
 */
export class MockPaymentDisabledError extends Error {
  readonly code = 'MOCK_PAYMENT_DISABLED';
  constructor() {
    super('Mock payment completion is disabled in this environment');
    this.name = 'MockPaymentDisabledError';
  }
}

export function isMockPaymentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production') return false;
  return env.PAYMENT_MOCK_ENABLED === 'true';
}

export function assertMockPaymentEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (!isMockPaymentEnabled(env)) throw new MockPaymentDisabledError();
}

/** When disabled the route behaves as if it did not exist (the app's own 404 answer), before any authentication or database work. */
export function requireMockPaymentEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!isMockPaymentEnabled()) return res.status(404).json({ error: 'Route not found' });
  next();
}
