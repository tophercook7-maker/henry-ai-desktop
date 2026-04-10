/**
 * Scripture lookup for Biblical mode: IPC returns full result; helpers format prompt text.
 */

import type { ScriptureEntry } from './scriptureStore';
import type { ParsedScriptureReference } from './scriptureReference';
import { CHAPTER_VERSE_PLACEHOLDER_END, parseScriptureReference } from './scriptureReference';

export interface ScriptureLookupResult {
  found: boolean;
  parsed: ParsedScriptureReference | null;
  parseError?: string;
  normalizedReference?: string;
  text?: string;
  sourceProfileId?: string | null;
  sourceLabel?: string | null;
  notes?: string | null;
  guidance?: string;
  entry?: ScriptureEntry;
}

const NOT_FOUND_GUIDANCE =
  'This passage is not in Henry’s local scripture store yet. Do not invent verse text. Offer to discuss the topic from general knowledge only if clearly labeled as commentary or interpretation, or suggest the user import a JSON bundle for this translation.';

const PARSE_FAIL_GUIDANCE =
  'The user’s message did not match a parsable reference on the first line. Do not guess a passage; ask for a clear reference (e.g. John 3:16) if needed.';

const READ_OPEN_PREFIX = /^(please\s+)?(read|show|open|look\s*up|lookup)\s+/i;

function scriptureReferenceCandidatesFromFirstLine(firstLine: string): string[] {
  const t = firstLine.trim();
  const out: string[] = [];
  if (t) out.push(t);
  const stripped = t.replace(READ_OPEN_PREFIX, '').trim();
  if (stripped && stripped !== t) out.push(stripped);
  return out;
}

export async function lookupScripture(referenceLine: string): Promise<ScriptureLookupResult> {
  return window.henryAPI.scriptureLookup(referenceLine.trim());
}

/**
 * Only runs lookup when the first line (optionally after "Read …" / "Look up …") parses as a reference.
 */
export async function lookupScriptureFromUserMessage(userContent: string): Promise<ScriptureLookupResult | null> {
  const first = userContent.trim().split('\n')[0]?.trim() ?? '';
  if (!first || first.length > 160) return null;
  for (const c of scriptureReferenceCandidatesFromFirstLine(first)) {
    if (parseScriptureReference(c).ok) return lookupScripture(c);
  }
  return null;
}

export { NOT_FOUND_GUIDANCE, PARSE_FAIL_GUIDANCE };

/** Optional: UI-selected Bible profile for study lens + mismatch hints vs store row */
export interface ScriptureLookupPromptContext {
  activeBibleProfileLabel?: string | null;
  activeBibleProfileId?: string | null;
}

function formatActiveProfileNote(ctx: ScriptureLookupPromptContext | undefined): string {
  const label = ctx?.activeBibleProfileLabel?.trim();
  const id = ctx?.activeBibleProfileId?.trim();
  if (!label && !id) return '';
  const line =
    label && id
      ? `**User-selected study profile (UI):** ${label} (\`${id}\`)`
      : label
        ? `**User-selected study profile (UI):** ${label}`
        : `**User-selected study profile (UI):** \`${id}\``;
  return `${line}\nUse this as the user’s preferred study/canon lens for commentary and cross-refs; it does not change imported verse text.`;
}

/** Markdown block for lean memory / system context */
export function formatScriptureLookupForPrompt(
  result: ScriptureLookupResult,
  ctx?: ScriptureLookupPromptContext
): string {
  const profileBlock = formatActiveProfileNote(ctx);
  const profilePrefix = profileBlock ? `${profileBlock}\n\n` : '';

  if (!result.parsed && result.parseError) {
    return `## Local scripture lookup\n${profilePrefix}**Parse:** ${result.parseError}\n${result.guidance ?? ''}\n\nContinue the conversation normally; do not invent verse text.`;
  }
  const p = result.parsed;
  if (!p) {
    return `## Local scripture lookup\n${profilePrefix}${result.guidance ?? ''}`;
  }
  const ref =
    p.verseEnd === CHAPTER_VERSE_PLACEHOLDER_END
      ? `${p.book} ${p.chapter} (whole chapter)`
      : `${p.book} ${p.chapter}:${p.verseStart}${p.verseEnd !== p.verseStart ? `–${p.verseEnd}` : ''}`;
  if (result.found && result.text) {
    const src =
      result.sourceLabel || result.sourceProfileId
        ? `**Source (imported row):** ${result.sourceLabel ?? result.sourceProfileId ?? 'unknown'}`
        : '**Source (imported row):** (unspecified in store)';
    const notes = result.notes?.trim() ? `\n**Store notes:** ${result.notes.trim()}` : '';
    const rowId = result.entry?.sourceProfileId ?? result.sourceProfileId;
    const activeId = ctx?.activeBibleProfileId?.trim();
    const mismatch =
      activeId && rowId && activeId !== rowId
        ? `\n**Note:** Imported text is tagged \`${rowId}\`; the user’s UI profile is \`${activeId}\` — name the difference if you discuss translation or study notes.\n`
        : '';
    return `## Local scripture lookup (direct text from store)\n${profilePrefix}**Reference:** ${ref}\n${src}${mismatch}\n**Scripture (local store):**\n> ${result.text.replace(/\n/g, '\n> ')}${notes}\n\nLabel anything you add beyond this block as commentary, interpretation, historical context, or speculation — not scripture.`;
  }
  return `## Local scripture lookup\n${profilePrefix}**Reference parsed:** ${ref} (\`${p.normalizedReference}\`)\n**Status:** scripture text **not found** in the local store.\n${result.guidance ?? NOT_FOUND_GUIDANCE}\n\nProceed with the normal study conversation: answer from general knowledge only with clear labels (commentary / interpretation / speculation), or invite the user to import this passage.`;
}
