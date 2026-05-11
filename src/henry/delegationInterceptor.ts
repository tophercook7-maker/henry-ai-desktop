/**
 * Delegation Interceptor — runs BEFORE the AI call.
 * Detects "tell ChatGPT/Claude/Slack to X" and executes it directly
 * via real computer IPCs instead of hoping the AI outputs the right pattern.
 */

export interface DelegationTarget {
  appName: string;       // e.g. "Google Chrome"
  openCommand: string;   // e.g. "open https://chatgpt.com"
  task: string;          // what to type/do in the app
  isAI: boolean;         // true if target is an AI chatbot (type into input)
}

// Maps user-friendly names to real app names + URLs
const DELEGATION_MAP: Record<string, { app: string; url: string }> = {
  'chatgpt':   { app: 'Google Chrome', url: 'https://chatgpt.com' },
  'chat gpt':  { app: 'Google Chrome', url: 'https://chatgpt.com' },
  'gpt':       { app: 'Google Chrome', url: 'https://chatgpt.com' },
  'claude':    { app: 'Google Chrome', url: 'https://claude.ai' },
  'gemini':    { app: 'Google Chrome', url: 'https://gemini.google.com' },
  'perplexity':{ app: 'Google Chrome', url: 'https://perplexity.ai' },
  'copilot':   { app: 'Google Chrome', url: 'https://copilot.microsoft.com' },
  'slack':     { app: 'Slack',         url: '' },
  'notion':    { app: 'Notion',        url: '' },
  'discord':   { app: 'Discord',       url: '' },
  'messages':  { app: 'Messages',      url: '' },
  'mail':      { app: 'Mail',          url: '' },
  'gmail':     { app: 'Google Chrome', url: 'https://mail.google.com' },
  'chrome':    { app: 'Google Chrome', url: '' },
  'safari':    { app: 'Safari',        url: '' },
  'terminal':  { app: 'Terminal',      url: '' },
  'iterm':     { app: 'iTerm',         url: '' },
  'cursor':    { app: 'Cursor',        url: '' },
  'vscode':    { app: 'Visual Studio Code', url: '' },
  'vs code':   { app: 'Visual Studio Code', url: '' },
  'spotify':   { app: 'Spotify',       url: '' },
  'zoom':      { app: 'Zoom',          url: '' },
};

// Patterns: "tell ChatGPT to write a poem" / "ask Claude to continue"
const DELEGATION_RE = /^(?:tell|ask|have|get|make|instruct)\s+([\w\s]+?)\s+(?:to|and)\s+(.+)$/i;

// Also handle: "open ChatGPT and write a poem"
const OPEN_AND_RE = /^(?:open|go to|launch)\s+([\w\s]+?)\s+and\s+(.+)$/i;

// "continue in ChatGPT" / "type X in Chrome"
const TYPE_IN_RE = /^(?:type|write|send|say|put)\s+(.+?)\s+in(?:\s+the)?\s+([\w\s]+)$/i;

export function parseDelegation(message: string): DelegationTarget | null {
  // Never fire on questions — if it starts with a question word, bail immediately
  const QUESTION_RE = /^(what|which|how|who|where|when|is|are|do|does|did|can|could|would|will|should|why|tell me about|show me)/i;
  if (QUESTION_RE.test(message.trim())) return null;

  // Must contain a known app name to be a delegation — prevents false positives
  const hasKnownApp = Object.keys(DELEGATION_MAP).some(key =>
    message.toLowerCase().includes(key)
  );
  if (!hasKnownApp) return null;

  let targetName = '';
  let task = '';

  const m1 = message.match(DELEGATION_RE);
  const m2 = message.match(OPEN_AND_RE);
  const m3 = message.match(TYPE_IN_RE);

  if (m1) {
    targetName = m1[1].trim().toLowerCase();
    task = m1[2].trim();
  } else if (m2) {
    targetName = m2[1].trim().toLowerCase();
    task = m2[2].trim();
  } else if (m3) {
    task = m3[1].trim();
    targetName = m3[2].trim().toLowerCase();
  } else {
    return null;
  }

  // Find the best matching app
  let target = DELEGATION_MAP[targetName];
  if (!target) {
    // Partial match
    for (const [key, val] of Object.entries(DELEGATION_MAP)) {
      if (targetName.includes(key) || key.includes(targetName)) {
        target = val;
        break;
      }
    }
  }
  if (!target) return null;

  const isAI = ['chatgpt','claude','gemini','gpt','copilot','perplexity'].some(n => targetName.includes(n));

  return {
    appName: target.app,
    openCommand: target.url ? `open ${target.url}` : `open -a "${target.app}"`,
    task,
    isAI,
  };
}

export async function executeDelegation(delegation: DelegationTarget): Promise<string> {
  const api = (window as any).henryAPI;
  if (!api) return 'Henry IPC not available — restart the app.';

  const results: string[] = [];

  try {
    // 1. Open the app / URL
    const openResult = await api.computerRunShell({
      command: delegation.openCommand,
      timeout: 5000,
    }) as { output?: string; error?: string };
    results.push(`✓ Opened ${delegation.appName}`);

    // 2. Wait for it to load
    await new Promise(r => setTimeout(r, 2500));

    // 3. Activate it
    await api.computerOsascript(
      `tell application "${delegation.appName}" to activate`
    );
    await new Promise(r => setTimeout(r, 800));

    // 4. For AI chatbots: click the input area first (Cmd+L or just click center)
    if (delegation.isAI) {
      // Try clicking the input area via osascript key shortcut (most web chatbots use standard input)
      await api.computerOsascript(
        `tell application "System Events" to keystroke "l" using command down`
      );
      await new Promise(r => setTimeout(r, 300));
    }

    // 5. Type the task
    const escaped = delegation.task.replace(/"/g, '\\"');
    await api.computerOsascript(
      `tell application "System Events" to keystroke "${escaped}"`
    );
    results.push(`✓ Typed: "${delegation.task}"`);

    await new Promise(r => setTimeout(r, 200));

    // 6. Press Enter to submit
    await api.computerOsascript(
      `tell application "System Events" to key code 36`
    );
    results.push(`✓ Submitted`);

    return results.join('\n');
  } catch (e) {
    return `✗ ${e instanceof Error ? e.message : String(e)}`;
  }
}
