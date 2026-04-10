/**
 * Henry lean memory policy — single place for what goes into the Companion system prompt.
 * Raw data comes from IPC (`memory:buildContext` → HenryLeanMemoryParts); formatting happens here.
 */

import type { HenryLeanMemoryParts } from '../types';
import type { HenryOperatingMode } from './charter';

/** Caps for prompt-sized memory (tune without touching IPC). */
export const HENRY_MEMORY_CAPS = {
  /** Max distinct facts after deduplication */
  maxFactsInPrompt: 8,
  /** Conversation rollup length */
  maxSummaryChars: 1500,
  /** Indexed workspace rows shown */
  maxWorkspaceHints: 3,
  /** User/assistant turns sent as chat messages (not in system block) */
  maxRecentMessagesInTranscript: 8,
  /** Per-message truncation in transcript */
  maxMessageCharsEach: 600,
} as const;

export function normalizeFactKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * Drop near-duplicate facts (normalized text) while preserving first-seen order.
 */
export function dedupeFactsTop(
  facts: ReadonlyArray<{ fact: string; category: string }>,
  max: number
): Array<{ fact: string; category: string }> {
  const seen = new Set<string>();
  const out: Array<{ fact: string; category: string }> = [];
  for (const f of facts) {
    const k = normalizeFactKey(f.fact);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ fact: f.fact.trim(), category: (f.category || 'general').trim() || 'general' });
    if (out.length >= max) break;
  }
  return out;
}

export function capMessageContent(content: string, max: number): string {
  const t = content.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function sliceRecentThreadMessages<T extends { role: string; content: string }>(
  items: T[],
  max: number
): T[] {
  if (items.length <= max) return items;
  return items.slice(-max);
}

function categorySortOrder(category: string): number {
  const c = category.toLowerCase();
  if (c.includes('decision')) return 0;
  if (c.includes('next') || c.includes('step') || c.includes('action')) return 1;
  if (c.includes('prefer')) return 2;
  if (c.includes('project') || c.includes('task')) return 3;
  return 4;
}

export interface BuildHenryMemoryContextInput {
  mode: HenryOperatingMode;
  lean: HenryLeanMemoryParts;
  /** Settings `workspace_path` — active folder */
  workspacePathHint?: string | null;
  /** Current conversation title — lightweight “project/thread” hint */
  conversationTitle?: string | null;
  /** When `mode` is `biblical`: active Bible source profile label (lean memory, no duplication of charter). */
  biblicalSourceProfileLabel?: string | null;
  /** When `mode` is `writer`: selected document type label. */
  writerDocumentTypeLabel?: string | null;
  /** When `mode` is `design3d`: workflow label. */
  design3dWorkflowLabel?: string | null;
  /** When `mode` is `design3d`: optional line from Files-tab reference hook. */
  design3dReferenceNote?: string | null;
  /** User-selected file/folder for chat (path + honesty; pre-formatted section). */
  activeWorkspaceContextBlock?: string | null;
}

/**
 * Compact markdown-ish block for the system prompt (summary, facts, workspace, anchors).
 * Does not include raw transcript — that stays in the message list with its own cap.
 */
export function buildHenryMemoryContextBlock(input: BuildHenryMemoryContextInput): string {
  const facts = dedupeFactsTop(input.lean.facts, HENRY_MEMORY_CAPS.maxFactsInPrompt);
  const sortedFacts = [...facts].sort(
    (a, b) => categorySortOrder(a.category) - categorySortOrder(b.category)
  );

  const lines: string[] = [];

  lines.push('## Session anchors');
  lines.push(`- Operating mode: **${input.mode}**`);
  const bibleLabel = input.biblicalSourceProfileLabel?.trim();
  if (input.mode === 'biblical' && bibleLabel) {
    lines.push(`- Bible source profile: ${bibleLabel}`);
  }
  const writerLabel = input.writerDocumentTypeLabel?.trim();
  if (input.mode === 'writer' && writerLabel) {
    lines.push(`- Document type: ${writerLabel}`);
  }
  const d3Label = input.design3dWorkflowLabel?.trim();
  if (input.mode === 'design3d' && d3Label) {
    lines.push(`- Design3D workflow: ${d3Label}`);
  }
  const ws = input.workspacePathHint?.trim();
  if (ws) lines.push(`- Active workspace: \`${ws}\``);
  const title = input.conversationTitle?.trim();
  if (title) lines.push(`- Active thread: ${title}`);

  const summary = input.lean.conversationSummary?.trim();
  if (summary) {
    const clipped =
      summary.length > HENRY_MEMORY_CAPS.maxSummaryChars
        ? `${summary.slice(0, HENRY_MEMORY_CAPS.maxSummaryChars)}…`
        : summary;
    lines.push('');
    lines.push('## Conversation rollup');
    lines.push(clipped);
  }

  if (sortedFacts.length > 0) {
    lines.push('');
    lines.push('## Memory (facts, preferences, decisions, next steps)');
    for (const f of sortedFacts) {
      lines.push(`- [${f.category}] ${f.fact}`);
    }
  }

  const hints = input.lean.workspaceHints.slice(0, HENRY_MEMORY_CAPS.maxWorkspaceHints);
  if (hints.length > 0) {
    lines.push('');
    lines.push('## Indexed workspace (relevant)');
    for (const h of hints) {
      const sum = (h.summary || '').trim();
      lines.push(`- \`${h.file_path}\`${sum ? `: ${sum}` : ''}`);
    }
  }

  const refNote = input.design3dReferenceNote?.trim();
  if (input.mode === 'design3d' && refNote) {
    lines.push('');
    lines.push('## Reference context');
    lines.push(refNote);
  }

  const wsSel = input.activeWorkspaceContextBlock?.trim();
  if (wsSel) {
    lines.push('');
    lines.push(wsSel);
  }

  return lines.join('\n').trim();
}
