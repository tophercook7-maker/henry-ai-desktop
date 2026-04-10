/**
 * Import scripture rows from JSON (validated, then IPC bulk insert).
 */

import { parseScriptureReference } from './scriptureReference';

export interface ScriptureImportRow {
  reference: string;
  text: string;
  sourceProfileId?: string;
  sourceLabel?: string;
  notes?: string;
}

export interface ScriptureImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Validate unknown JSON as an array of import rows.
 */
export function validateScriptureImportJson(data: unknown): ScriptureImportRow[] | { error: string } {
  if (!Array.isArray(data)) {
    return { error: 'Root JSON must be an array of objects.' };
  }
  const out: ScriptureImportRow[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!isRecord(row)) {
      return { error: `Item ${i} is not an object.` };
    }
    const ref = row.reference;
    const text = row.text;
    if (typeof ref !== 'string' || !ref.trim()) {
      return { error: `Item ${i}: missing string "reference".` };
    }
    if (typeof text !== 'string' || !text.trim()) {
      return { error: `Item ${i}: missing string "text".` };
    }
    out.push({
      reference: ref.trim(),
      text: text.trim(),
      sourceProfileId: typeof row.sourceProfileId === 'string' ? row.sourceProfileId : undefined,
      sourceLabel: typeof row.sourceLabel === 'string' ? row.sourceLabel : undefined,
      notes: typeof row.notes === 'string' ? row.notes : undefined,
    });
  }
  return out;
}

/** Quick check that a reference will parse before sending to main. */
export function scriptureImportRowParses(row: ScriptureImportRow): boolean {
  return parseScriptureReference(row.reference).ok;
}

export async function importScriptureFromValidatedRows(
  rows: ScriptureImportRow[]
): Promise<ScriptureImportResult> {
  return window.henryAPI.scriptureImport(rows);
}

export async function importScriptureJson(data: unknown): Promise<ScriptureImportResult> {
  const v = validateScriptureImportJson(data);
  if ('error' in v) {
    return { imported: 0, skipped: 0, errors: [v.error] };
  }
  return importScriptureFromValidatedRows(v);
}
