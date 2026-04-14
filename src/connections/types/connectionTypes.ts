/**
 * Connection Layer — shared types.
 *
 * Every service connection, onboarding flow, health model,
 * and action binding uses these types.
 */

// ── Status ────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'error';

// ── Connection records ────────────────────────────────────────────────────────

export interface ServiceConnection {
  status: ConnectionStatus;
  connectedAt?: number;
  errorMessage?: string;
}

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleConnection extends ServiceConnection {
  profile: GoogleProfile | null;
}

/** Rich record for the integrations hub. Panels use the lighter ServiceConnection. */
export interface ConnectionRecord {
  id: string;
  service: string;
  status: ConnectionStatus;
  displayName?: string;
  accountLabel?: string;
  lastConnectedAt?: number;
  expiresAt?: number;
  scopes?: string[];
  errorMessage?: string;
  capabilities?: string[];
}

// ── Health ────────────────────────────────────────────────────────────────────

export type ConnectionHealth =
  | 'healthy'
  | 'needs_reconnect'
  | 'auth_expired'
  | 'partial'
  | 'unavailable';

export interface HealthResult {
  health: ConnectionHealth;
  message?: string;
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export type OnboardingMode = 'google-oauth' | 'guided-token';

export interface OnboardingConfig {
  mode: OnboardingMode;
  icon: string;
  name: string;
  tagline: string;
  benefits: [string, string, string];
  steps?: string[];
  tokenLabel?: string;
  tokenPlaceholder?: string;
  docsUrl?: string;
  docsLabel?: string;
}

// ── Provider interface ────────────────────────────────────────────────────────

/** Every service provider implements this contract. */
export interface ConnectionProvider {
  /** Human-readable list of what this connection unlocks. */
  getCapabilities(): string[];
  /** Validate a stored token against the real API. */
  checkHealth(token: string): Promise<HealthResult>;
  /** Onboarding flow config for ConnectScreen. */
  getOnboardingConfig(): OnboardingConfig;
}
