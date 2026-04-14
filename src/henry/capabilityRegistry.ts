/**
 * Henry AI — Capability Registry
 *
 * Single source of truth for what Henry can actually do at runtime.
 * Reads live connection state and reflects actual implementation status.
 *
 * Rules:
 *   - A capability is listed as `true` only if it is fully implemented and working.
 *   - Connection status is read directly from the same token source the UI uses.
 *   - This registry is injected into the system prompt so Henry never claims
 *     capabilities that do not exist.
 *
 * Do NOT mark anything `true` here unless the code fully implements it.
 */

import { isConnected } from './integrations';

// ── Computer / Device Capabilities ───────────────────────────────────────────

/**
 * What Henry can actually do at the OS / device layer.
 *
 * These are hard-coded constants — they reflect what is implemented in
 * electron/ipc/* and the preload bridge. Update here only when the
 * feature is actually built and shipped.
 */
export const COMPUTER_CAPABILITIES = {
  /** Sandboxed read/write of text files inside the configured workspace folder. */
  workspaceFileAccess: true,

  /** Full shell/terminal execution (exec, spawn, arbitrary commands). NOT implemented. */
  shellAccess: false,

  /** AppleScript execution — app control, automation. NOT implemented. */
  applescript: false,

  /** Keyboard / mouse input injection / automation. NOT implemented. */
  inputAutomation: false,

  /** Screenshot capture. NOT implemented. */
  screenshot: false,

  /** System-wide file access (outside workspace). NOT implemented. */
  systemFileAccess: false,

  /** Open arbitrary apps. NOT implemented. */
  appControl: false,
} as const;

// ── Integration Capabilities ──────────────────────────────────────────────────

export interface IntegrationCapability {
  connected: boolean;
  canRead: boolean;
  canWrite: boolean;
}

/**
 * Returns live connection truth for every service.
 * `connected` is only true when an auth token actually exists in storage.
 * `canRead` / `canWrite` reflect whether those actions are implemented —
 * even a connected service may not have write support yet.
 */
export function getIntegrationCapabilities(): Record<string, IntegrationCapability> {
  const google = isConnected('gmail');   // gmail / gcal / gdrive share one token

  return {
    gmail: {
      connected: google,
      canRead:   google,   // thread listing, summarization — implemented
      canWrite:  google,   // save to Drafts — implemented
    },
    gcal: {
      connected: google,
      canRead:   google,   // event listing — implemented
      canWrite:  google,   // create events — implemented
    },
    gdrive: {
      connected: google,
      canRead:   google,   // export Docs/Sheets/Slides as text — implemented
      canWrite:  false,    // write back to Drive — NOT implemented
    },
    slack: {
      connected: isConnected('slack'),
      canRead:   isConnected('slack'),   // channel history — implemented
      canWrite:  isConnected('slack'),   // send messages — implemented
    },
    github: {
      connected: isConnected('github'),
      canRead:   isConnected('github'),  // PRs, issues — implemented
      canWrite:  isConnected('github'),  // create issues — implemented
    },
    notion: {
      connected: isConnected('notion'),
      canRead:   isConnected('notion'),  // page summaries — implemented
      canWrite:  isConnected('notion'),  // create pages — implemented
    },
    stripe: {
      connected: isConnected('stripe'),
      canRead:   isConnected('stripe'),  // charges, revenue — implemented
      canWrite:  false,                   // no write operations — NOT implemented
    },
    linear: {
      connected: isConnected('linear'),
      canRead:   isConnected('linear'),  // issues — implemented
      canWrite:  isConnected('linear'),  // create issues — implemented
    },
  };
}

// ── System Prompt Block ───────────────────────────────────────────────────────

/**
 * Returns a compact capability truth block for injection into the system prompt.
 * Henry reads this to know what is real right now — not what could theoretically exist.
 */
export function buildCapabilityRegistryBlock(): string {
  const integrations = getIntegrationCapabilities();

  // Computer layer
  const computerLines: string[] = [
    `  Workspace file access (read/write text files in workspace): YES`,
    `  Shell / terminal execution: NO — not implemented`,
    `  AppleScript / app control: NO — not implemented`,
    `  Keyboard / mouse automation: NO — not implemented`,
    `  Screenshots: NO — not implemented`,
    `  System-wide file access: NO — sandboxed to workspace only`,
  ];

  // Integration layer
  const connectedNames: string[] = [];
  const notConnectedNames: string[] = [];

  for (const [id, cap] of Object.entries(integrations)) {
    const label = id.charAt(0).toUpperCase() + id.slice(1);
    if (cap.connected) {
      const ops = [cap.canRead && 'read', cap.canWrite && 'write'].filter(Boolean).join(' + ');
      connectedNames.push(`${label} (${ops})`);
    } else {
      notConnectedNames.push(label);
    }
  }

  const integrationSection = [
    connectedNames.length > 0
      ? `  Connected and usable: ${connectedNames.join(', ')}`
      : `  Connected and usable: none`,
    notConnectedNames.length > 0
      ? `  Not connected: ${notConnectedNames.join(', ')}`
      : null,
  ].filter(Boolean).join('\n');

  return `## Runtime Capability State (what is actually true right now)

Computer / device layer:
${computerLines.join('\n')}

Integration layer:
${integrationSection}

This is the ground truth. Henry must ONLY claim capabilities listed as active above.
Do not claim shell access, AppleScript, automation, or screenshot capability — they are not implemented.
Do not claim a service is connected unless it appears in the "Connected and usable" list above.`.trim();
}
