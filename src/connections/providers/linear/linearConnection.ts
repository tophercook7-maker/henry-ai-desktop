/**
 * Linear provider — API key auth.
 */

import type { ConnectionProvider, OnboardingConfig, HealthResult } from '../../types/connectionTypes';
import { getToken } from '../../../henry/integrations';

export const LINEAR_CAPABILITIES = [
  'List issues assigned to you across all teams',
  'Filter by priority (urgent, high, all)',
  'See issue state, labels, and team grouping',
];

const ONBOARDING: OnboardingConfig = {
  mode: 'guided-token',
  icon: '🔷',
  name: 'Linear',
  tagline: 'See all issues assigned to you, filtered by priority.',
  benefits: [
    'See your assigned issues without opening Linear',
    'Filter by urgent or high priority at a glance',
    'Stay on top of work across all your teams',
  ],
  steps: [
    'Go to linear.app/settings/api',
    'Click Create key and give it a label',
    'Copy the API key — it starts with lin_api_',
  ],
  tokenLabel: 'API Key',
  tokenPlaceholder: 'lin_api_…',
  docsUrl: 'https://linear.app/settings/api',
  docsLabel: 'Open Linear API settings',
};

async function checkHealth(_token: string): Promise<HealthResult> {
  const token = getToken('linear');
  if (!token) return { health: 'unavailable', message: 'No key saved.' };
  try {
    const r = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
    });
    const d = await r.json();
    if (d?.data?.viewer?.id) return { health: 'healthy' };
    return { health: 'auth_expired', message: 'Linear key is invalid or revoked.' };
  } catch {
    return { health: 'unavailable', message: 'Could not reach Linear.' };
  }
}

export const linearConnection: ConnectionProvider = {
  getCapabilities: () => LINEAR_CAPABILITIES,
  checkHealth,
  getOnboardingConfig: () => ONBOARDING,
};
