/**
 * Google Drive action handlers.
 *
 * Fully implemented:
 *   drive.summarize_file   — exports actual file content, sends to Henry chat
 *   drive.send_file_to_chat — sends file info + content preview to Henry chat
 *
 * Content reading: Google Docs/Sheets/Slides export as plain text via the
 * Drive export API. Other files download their raw content (capped at 200 KB).
 */

import { registerHandler } from '../../registry/actionRegistry';
import { sendToHenry } from '../../store/chatBridgeStore';
import { driveExportFileContent } from '../../../henry/integrations';
import type { ActionInput, ActionResult } from '../../types/actionTypes';

interface DriveFileInput {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

function mimeLabel(mimeType?: string): string {
  const labels: Record<string, string> = {
    'application/vnd.google-apps.document':     'Google Doc',
    'application/vnd.google-apps.spreadsheet':  'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/pdf':                          'PDF',
  };
  return labels[mimeType ?? ''] ?? 'file';
}

const CONTENT_SUPPORTED = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'text/plain',
  'text/markdown',
  'text/html',
  'application/json',
]);

async function summarizeFile(input: ActionInput): Promise<ActionResult> {
  const file = input as DriveFileInput;
  const label = mimeLabel(file.mimeType);
  const fileName = file.name ?? 'this file';

  const metaLines = [
    `Name: ${fileName}`,
    `Type: ${label}`,
    file.modifiedTime ? `Last modified: ${new Date(file.modifiedTime).toLocaleDateString()}` : null,
    file.webViewLink ? `Link: ${file.webViewLink}` : null,
  ].filter(Boolean).join('\n');

  // Try to fetch actual content for supported types
  if (file.id && file.mimeType && CONTENT_SUPPORTED.has(file.mimeType)) {
    try {
      const content = await driveExportFileContent(file.id, file.mimeType);
      const trimmed = content.trim();
      const preview = trimmed.length > 12_000 ? trimmed.slice(0, 12_000) + '\n\n[content truncated for context]' : trimmed;

      const prompt = [
        `Summarize this ${label} from my Google Drive:`,
        '',
        metaLines,
        '',
        '--- Content ---',
        preview,
        '--- End ---',
        '',
        'Give me: (1) what this document covers, (2) the key points or takeaways, (3) anything actionable or important I should know.',
      ].join('\n');

      sendToHenry(prompt);
      return { success: true, message: 'Opened in Henry chat' };
    } catch {
      // Fall through to metadata-only prompt
    }
  }

  // Metadata-only fallback (non-exportable types like PDFs)
  const prompt = [
    `Summarize what you can about this ${label} from my Google Drive:`,
    '',
    metaLines,
    '',
    `I can't extract the content directly, but based on the filename and type, what do you think this covers? What questions should I be asking about it?`,
  ].join('\n');

  sendToHenry(prompt);
  return { success: true, message: 'Opened in Henry chat' };
}

async function sendFileToChat(input: ActionInput): Promise<ActionResult> {
  const file = input as DriveFileInput;
  const label = mimeLabel(file.mimeType);

  let contentPreview = '';
  if (file.id && file.mimeType && CONTENT_SUPPORTED.has(file.mimeType)) {
    try {
      const content = await driveExportFileContent(file.id, file.mimeType);
      contentPreview = content.trim().slice(0, 4000);
    } catch { /* no content — continue without */ }
  }

  const lines = [
    `I want to discuss this Drive file with you:`,
    '',
    `Name: ${file.name ?? 'Untitled'}`,
    `Type: ${label}`,
    file.modifiedTime ? `Modified: ${new Date(file.modifiedTime).toLocaleDateString()}` : null,
    file.webViewLink ? `Link: ${file.webViewLink}` : null,
    contentPreview ? `\n--- Content preview ---\n${contentPreview}\n--- End ---` : null,
    '',
    `What can you help me do with this?`,
  ].filter(Boolean).join('\n');

  sendToHenry(lines);
  return { success: true, message: 'Opened in Henry chat' };
}

export function registerDriveHandlers() {
  registerHandler('drive.summarize_file',    summarizeFile);
  registerHandler('drive.send_file_to_chat', sendFileToChat);
}
