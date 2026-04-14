/**
 * Google Drive — data layer.
 *
 * Re-exports the API function from integrations.ts
 * and adds Drive-specific helpers.
 */

export type { DriveFile } from '../../henry/integrations';
export { driveListFiles } from '../../henry/integrations';

/** Map MIME type to a display label and emoji icon. */
export function driveFileIcon(mimeType: string): { icon: string; label: string } {
  const map: Record<string, { icon: string; label: string }> = {
    'application/vnd.google-apps.document':     { icon: '📝', label: 'Doc' },
    'application/vnd.google-apps.spreadsheet':  { icon: '📊', label: 'Sheet' },
    'application/vnd.google-apps.presentation': { icon: '📽️', label: 'Slides' },
    'application/vnd.google-apps.form':         { icon: '📋', label: 'Form' },
    'application/pdf':                          { icon: '📄', label: 'PDF' },
    'image/jpeg':                               { icon: '🖼️', label: 'Image' },
    'image/png':                                { icon: '🖼️', label: 'Image' },
    'video/mp4':                                { icon: '🎬', label: 'Video' },
    'application/zip':                          { icon: '🗜️', label: 'Archive' },
  };
  return map[mimeType] ?? { icon: '📁', label: 'File' };
}

/** Format a Drive file's modified date for display. */
export function driveFormatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
