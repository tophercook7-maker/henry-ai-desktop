/**
 * Biblical study output scaffold — aligned with `formatBiblicalResponse.ts` sectioning.
 */

import { formatBiblicalResponseMarkdown } from './formatBiblicalResponse';
import type { ScriptureLookupResult } from './scriptureLookup';
import { CHAPTER_VERSE_PLACEHOLDER_END } from './scriptureReference';

function referenceLineFromParsed(p: NonNullable<ScriptureLookupResult['parsed']>): string {
  return p.verseEnd === CHAPTER_VERSE_PLACEHOLDER_END
    ? `${p.book} ${p.chapter} (whole chapter)`
    : `${p.book} ${p.chapter}:${p.verseStart}${p.verseEnd !== p.verseStart ? `–${p.verseEnd}` : ''}`;
}

/** First line only — triggers automatic lookup in Biblical chat when sent. */
export function buildUseInChatReferenceLine(result: ScriptureLookupResult): string | null {
  if (!result.parsed) return null;
  return result.parsed.rawInput.trim();
}

/** Full study request for chat input when a verse was found in the local store. */
export function buildStudyChatPromptFromLookup(result: ScriptureLookupResult): string | null {
  if (!result.found || !result.text || !result.parsed) return null;
  const ref = referenceLineFromParsed(result.parsed);
  const src = result.sourceLabel ?? result.sourceProfileId ?? 'unspecified';
  const quoted = result.text.replace(/\n/g, '\n> ');
  return `Work through this passage using Henry’s study structure: **Direct Scripture**, **Plain explanation**, **Cross-references**, **Commentary / interpretation notes**, **Confidence / uncertainty**.

Treat only the quoted block below as scripture text from the local store; label everything else (commentary, interpretation, historical context, speculation) clearly.

**Reference:** ${ref}
**Source (store):** ${src}

**Scripture (local store):**
> ${quoted}

Suggested response shape:
\`\`\`markdown
${getStudyNoteScaffoldMarkdown()}
\`\`\``;
}

/** Empty study note as markdown (placeholders for model or user to replace). */
export function getStudyNoteScaffoldMarkdown(): string {
  return formatBiblicalResponseMarkdown({
    directScripture: '—',
    plainExplanation: '—',
    crossReferences: '—',
    commentaryNotes: '—',
    confidenceNote: '—',
  });
}

/** Short system-prompt addition (pairs with getBiblicalResponseScaffoldHint in charter). */
export function getStudyNoteScaffoldHint(): string {
  return `Study workflow: for structured answers, follow the same five-part pattern as Henry’s Biblical formatter — **Direct Scripture**, **Plain explanation**, **Cross-references**, **Commentary / interpretation notes**, **Confidence / uncertainty**. Optional empty scaffold:\n\`\`\`markdown\n${getStudyNoteScaffoldMarkdown()}\n\`\`\``;
}
