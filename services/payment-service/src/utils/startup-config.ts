import { checkServiceToken } from './service-token';

/**
 * Settings without which this service must not start (FIX 07B-2A). Pure: it only reads the env object it is given, so importing it
 * has no side effect; src/index.ts calls it before listening (and before the outbox / Stripe workers start) and exits when anything
 * is reported.
 *
 *   ORDER_PAYMENT_TOKEN  the Order <-> Payment credential (same value in both services): long, random, not a public default.
 */
export function startupConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const orderPayment = checkServiceToken('ORDER_PAYMENT_TOKEN', env.ORDER_PAYMENT_TOKEN);
  if (!orderPayment.ok) problems.push(orderPayment.reason);
  return problems;
}
