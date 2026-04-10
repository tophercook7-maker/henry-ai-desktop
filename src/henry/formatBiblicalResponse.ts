/**
 * Lightweight scaffold for Biblical mode answers (no validation of scripture text).
 */

export interface BiblicalResponseSections {
  directScripture?: string;
  plainExplanation?: string;
  crossReferences?: string;
  commentaryNotes?: string;
  confidenceNote?: string;
}

/**
 * Build markdown from filled sections; skips empty sections.
 */
export function formatBiblicalResponseMarkdown(sections: BiblicalResponseSections): string {
  const blocks: string[] = [];

  if (sections.directScripture?.trim()) {
    blocks.push(`### Direct Scripture\n\n${sections.directScripture.trim()}`);
  }
  if (sections.plainExplanation?.trim()) {
    blocks.push(`### Plain explanation\n\n${sections.plainExplanation.trim()}`);
  }
  if (sections.crossReferences?.trim()) {
    blocks.push(`### Cross-references\n\n${sections.crossReferences.trim()}`);
  }
  if (sections.commentaryNotes?.trim()) {
    blocks.push(`### Commentary / interpretation notes\n\n${sections.commentaryNotes.trim()}`);
  }
  if (sections.confidenceNote?.trim()) {
    blocks.push(`### Confidence / uncertainty\n\n${sections.confidenceNote.trim()}`);
  }

  return blocks.join('\n\n');
}

/** Short hint for the Companion system prompt (structure, not doctrine). */
export function getBiblicalResponseScaffoldHint(): string {
  return `For substantive answers, use clear sections when helpful: **Direct Scripture** (quote or careful paraphrase with label); **Plain explanation**; **Cross-references**; **Commentary / interpretation** (church fathers, study notes, theology); **Confidence / uncertainty**. Never present commentary or speculation as if it were scripture text.`;
}
