/**
 * Henry Builder Preview — utilities for extracting rendered HTML from
 * builder-mode responses and managing live iframe previews.
 */

/**
 * Extract the first complete HTML document from an AI message.
 * Looks for ```html ... ``` blocks first, then bare <!DOCTYPE blocks.
 */
export function extractHtmlFromMessage(content: string): string | null {
  const htmlBlock = content.match(/```html\s*([\s\S]+?)```/i);
  if (htmlBlock) return htmlBlock[1].trim();

  const genericBlock = content.match(/```\s*(<!DOCTYPE[\s\S]+?)```/i);
  if (genericBlock) return genericBlock[1].trim();

  return null;
}

/**
 * Download an HTML string as a .html file.
 */
export function downloadHtml(html: string, filename = 'app.html'): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
