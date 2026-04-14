/**
 * Stripe — data layer.
 *
 * Re-exports API functions from integrations.ts.
 * The Stripe panel imports from here.
 */

export type { StripeBalance, StripeCharge } from '../../henry/integrations';
export { stripeGetBalance, stripeListCharges } from '../../henry/integrations';

/** Format a Stripe amount (cents) into a currency string. */
export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

/** Map charge status to a display color class. */
export function chargeStatusColor(status: string): string {
  if (status === 'succeeded') return 'text-henry-success';
  if (status === 'failed')    return 'text-henry-error';
  return 'text-henry-warning';
}
