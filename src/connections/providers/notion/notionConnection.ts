/**
 * Notion provider — Internal Integration Token auth.
 */

import type { ConnectionProvider, OnboardingConfig, HealthResult } from '../../types/connectionTypes';
import { getToken } from '../../../henry/integrations';

export const NOTION_CAPABILITIES = [
  'Search across all shared pages and databases',
  'Read page content shared with your integration',
  'Attach Notion context to Henry conversations',
];

const ONBOARDING: OnboardingConfig = {
  mode: 'guided-token',
  icon: '📄',
  name: 'Notion',
  tagline: 'Search and read your pages and databases directly from Henry.',
  benefits: [
    'Find any Notion page without switching apps',
    'Ask Henry to summarize or reformat your notes',
    'Keep your knowledge base in reach while you work',
  ],
  steps: [
    'Go to notion.so/my-integrations and click New integration',
    'Give it a name and save — copy the Internal Integration Token (starts with secret_)',
    'In each Notion page you want Henry to see, click Share → Invite your integration',
  ],
  tokenLabel: 'Integration Token',
  tokenPlaceholder: 'secret_…',
  docsUrl: 'https://www.notion.so/my-integrations',
  docsLabel: 'Open Notion integrations',
};

async function checkHealth(_token: string): Promise<HealthResult> {
  const token = getToken('notion');
  if (!token) return { health: 'unavailable', message: 'No token saved.' };
  try {
    const r = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (r.status === 200) return { health: 'healthy' };
    if (r.status === 401) return { health: 'auth_expired', message: 'Notion token is invalid or revoked.' };
    return { health: 'unavailable', message: `Notion returned ${r.status}.` };
  } catch {
    return { health: 'unavailable', message: 'Could not reach Notion.' };
  }
}

export const notionConnection: ConnectionProvider = {
  getCapabilities: () => NOTION_CAPABILITIES,
  checkHealth,
  getOnboardingConfig: () => ONBOARDING,
};
