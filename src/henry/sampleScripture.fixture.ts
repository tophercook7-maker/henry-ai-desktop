/**
 * Dev/test: public-domain sample rows bundled with the app (see sampleScripture.json).
 * Not auto-imported — call importHenrySampleScripture() when you want them in SQLite.
 */

import type { ScriptureImportResult, ScriptureImportRow } from './scriptureImport';
import { importScriptureJson } from './scriptureImport';
import raw from './sampleScripture.json';

export const HENRY_SAMPLE_SCRIPTURE_ROWS = raw as ScriptureImportRow[];

export async function importHenrySampleScripture(): Promise<ScriptureImportResult> {
  return importScriptureJson(HENRY_SAMPLE_SCRIPTURE_ROWS);
}
