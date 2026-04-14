/**
 * Notion — data layer.
 *
 * Re-exports API functions from integrations.ts.
 * The Notion panel imports from here.
 */

export type { NotionPage } from '../../henry/integrations';
export { notionSearch } from '../../henry/integrations';

/** Extract the title string from a Notion page's properties. */
export function getNotionPageTitle(page: {
  properties: Record<string, { type: string; title?: { plain_text: string }[] }>;
}): string {
  const props = page.properties;
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p.type === 'title' && p.title && p.title.length > 0) {
      return p.title.map((t) => t.plain_text).join('');
    }
  }
  return 'Untitled';
}
