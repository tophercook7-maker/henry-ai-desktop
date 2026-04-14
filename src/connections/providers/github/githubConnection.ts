/**
 * GitHub provider — Personal Access Token auth.
 */

import type { ConnectionProvider, OnboardingConfig, HealthResult } from '../../types/connectionTypes';
import { getToken } from '../../../henry/integrations';

export const GITHUB_CAPABILITIES = [
  'List repos you own or have access to',
  'Read open and closed issues',
  'Read open pull requests',
  'Create issues and triage repos with Henry',
];

const ONBOARDING: OnboardingConfig = {
  mode: 'guided-token',
  icon: '🐙',
  name: 'GitHub',
  tagline: 'Browse repos, triage issues, and review pull requests from Henry.',
  benefits: [
    'See all your repos and open issues at a glance',
    'Ask Henry to triage or summarize any repo',
    'Create issues and track PRs without leaving the app',
  ],
  steps: [
    'Go to github.com/settings/tokens/new',
    'Give it a name, select scopes: repo, read:user, read:org',
    'Click Generate token — it starts with ghp_',
    'Copy it and paste it below',
  ],
  tokenLabel: 'Personal Access Token',
  tokenPlaceholder: 'ghp_…',
  docsUrl: 'https://github.com/settings/tokens/new',
  docsLabel: 'Create a GitHub token',
};

async function checkHealth(_token: string): Promise<HealthResult> {
  const token = getToken('github');
  if (!token) return { health: 'unavailable', message: 'No token saved.' };
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (r.status === 200) return { health: 'healthy' };
    if (r.status === 401) return { health: 'auth_expired', message: 'GitHub token is invalid or expired.' };
    return { health: 'unavailable', message: `GitHub returned ${r.status}.` };
  } catch {
    return { health: 'unavailable', message: 'Could not reach GitHub.' };
  }
}

export const githubConnection: ConnectionProvider = {
  getCapabilities: () => GITHUB_CAPABILITIES,
  checkHealth,
  getOnboardingConfig: () => ONBOARDING,
};
