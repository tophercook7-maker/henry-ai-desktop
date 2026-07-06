/**
 * _speechText.ts — Pure text-prep helpers for TTS.
 *
 * Keeps markdown out of Henry's mouth: code blocks become "code omitted",
 * links collapse to their text, and structural characters (#, *, backticks,
 * table pipes) are stripped. Pure module — no Electron imports — so it's
 * unit-testable under vitest's plain-Node environment.
 */

/** Strip markdown so text sounds natural when spoken aloud. */
export function prepareSpeechText(markdown: string): string {
  if (!markdown) return '';
  let t = markdown;

  // Fenced code blocks → a spoken placeholder.
  t = t.replace(/```[\s\S]*?```/g, ' code omitted. ');
  t = t.replace(/~~~[\s\S]*?~~~/g, ' code omitted. ');

  // Images → alt text; links → link text.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Inline code → keep the content, drop the backticks.
  t = t.replace(/`([^`]*)`/g, '$1');

  // Headings, blockquotes, bullet markers (line-anchored, before emphasis).
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/^\s*[-*+]\s+/gm, '');

  // Bold / italic emphasis → plain text.
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*]+)\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/\b_([^_]+)_\b/g, '$1');

  // Any stray markdown characters + table pipes.
  t = t.replace(/[*#`]/g, '');
  t = t.replace(/\|/g, ' ');

  // Paragraph breaks become sentence pauses; collapse whitespace.
  t = t.replace(/\n{2,}/g, '. ');
  t = t.replace(/\n/g, ' ');
  t = t.replace(/\s{2,}/g, ' ');
  t = t.replace(/(\.\s*)+\./g, '.');

  return t.trim();
}
