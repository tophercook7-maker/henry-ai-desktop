/**
 * Stripe provider — Restricted or Secret key auth.
 */

import type { ConnectionProvider, OnboardingConfig, HealthResult } from '../../types/connectionTypes';
import { getToken } from '../../../henry/integrations';

export const STRIPE_CAPABILITIES = [
  'View available and pending balance',
  'Track recent charges and payment status',
  'See customer and subscription data (with broader scopes)',
];

const ONBOARDING: OnboardingConfig = {
  mode: 'guided-token',
  icon: '💳',
  name: 'Stripe',
  tagline: 'See your revenue and recent charges without leaving Henry.',
  benefits: [
    'See available and pending balance at a glance',
    'Track recent charges and payment status',
    'Stay on top of revenue without opening Stripe',
  ],
  steps: [
    'Go to dashboard.stripe.com/apikeys',
    'Click Create restricted key — set read-only for Balance and Charges',
    'Copy the key — it starts with rk_live_ or sk_live_',
  ],
  tokenLabel: 'Stripe API Key',
  tokenPlaceholder: 'rk_live_… or sk_live_…',
  docsUrl: 'https://dashboard.stripe.com/apikeys',
  docsLabel: 'Open Stripe API keys',
};

async function checkHealth(_token: string): Promise<HealthResult> {
  const token = getToken('stripe');
  if (!token) return { health: 'unavailable', message: 'No key saved.' };
  try {
    const r = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 200) return { health: 'healthy' };
    if (r.status === 401) return { health: 'auth_expired', message: 'Stripe key is invalid or revoked.' };
    return { health: 'unavailable', message: `Stripe returned ${r.status}.` };
  } catch {
    return { health: 'unavailable', message: 'Could not reach Stripe.' };
  }
}

export const stripeConnection: ConnectionProvider = {
  getCapabilities: () => STRIPE_CAPABILITIES,
  checkHealth,
  getOnboardingConfig: () => ONBOARDING,
};
