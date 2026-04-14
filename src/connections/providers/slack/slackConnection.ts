/**
 * Slack provider — Bot token auth, channel reads, message posting.
 */

import type { ConnectionProvider, OnboardingConfig, HealthResult } from '../../types/connectionTypes';
import { getToken } from '../../../henry/integrations';

export const SLACK_CAPABILITIES = [
  'List public channels and their members',
  'Read message history from any joined channel',
  'Send messages to channels and DMs',
  'Ask Henry to summarize channel activity',
];

const ONBOARDING: OnboardingConfig = {
  mode: 'guided-token',
  icon: '💬',
  name: 'Slack',
  tagline: 'Read channels, see messages, and send replies — all from Henry.',
  benefits: [
    'See channel activity without switching to Slack',
    'Ask Henry to summarize any channel',
    'Send messages directly from Henry',
  ],
  steps: [
    'Go to api.slack.com/apps and open your Slack app (or create a new one)',
    'Under OAuth & Permissions, add scopes: channels:read, channels:history, chat:write, users:read',
    'Click Install to Workspace and approve',
    'Copy the Bot User OAuth Token — it starts with xoxb-',
  ],
  tokenLabel: 'Bot Token',
  tokenPlaceholder: 'xoxb-…',
  docsUrl: 'https://api.slack.com/apps',
  docsLabel: 'Open Slack App settings',
};

async function checkHealth(_token: string): Promise<HealthResult> {
  const token = getToken('slack');
  if (!token) return { health: 'unavailable', message: 'No token saved.' };
  try {
    const r = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    if (d.ok) return { health: 'healthy' };
    if (d.error === 'invalid_auth') return { health: 'auth_expired', message: 'Slack token is invalid or revoked.' };
    return { health: 'unavailable', message: d.error };
  } catch {
    return { health: 'unavailable', message: 'Could not reach Slack.' };
  }
}

export const slackConnection: ConnectionProvider = {
  getCapabilities: () => SLACK_CAPABILITIES,
  checkHealth,
  getOnboardingConfig: () => ONBOARDING,
};
