/**
 * Google provider — covers Gmail, Calendar, and Drive.
 * One auth flow, one token, three capabilities.
 */

import type { ConnectionProvider, OnboardingConfig, HealthResult } from '../../types/connectionTypes';

export const GOOGLE_CAPABILITIES = [
  'Read Gmail inbox and message threads',
  'Read Google Calendar events (7-day window)',
  'Browse Google Drive files',
  'Attach context from Google services to Henry chat',
];

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

const ONBOARDING: OnboardingConfig = {
  mode: 'google-oauth',
  icon: '🔵',
  name: 'Google',
  tagline: 'One sign-in enables Gmail, Calendar, and Drive in Henry.',
  benefits: [
    'Read emails and let Henry summarize threads',
    "See today's meetings and get prep notes",
    'Browse Drive files and ask Henry about any document',
  ],
};

async function checkHealth(token: string): Promise<HealthResult> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 200) return { health: 'healthy' };
    if (r.status === 401) return { health: 'auth_expired', message: 'Google access token has expired.' };
    return { health: 'unavailable', message: `Google returned ${r.status}.` };
  } catch {
    return { health: 'unavailable', message: 'Could not reach Google.' };
  }
}

export const googleConnection: ConnectionProvider = {
  getCapabilities: () => GOOGLE_CAPABILITIES,
  checkHealth,
  getOnboardingConfig: () => ONBOARDING,
};
