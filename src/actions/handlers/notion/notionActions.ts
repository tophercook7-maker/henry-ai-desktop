/**
 * Notion action handlers.
 *
 * Fully implemented:
 *   notion.summarize_page    — summarizes a Notion page in Henry chat
 *   notion.create_page_draft — Henry drafts content for a new Notion page (chat)
 *   notion.create_page       — creates a real page via the Notion API (write + confirm)
 */

import { registerHandler } from '../../registry/actionRegistry';
import { sendToHenry } from '../../store/chatBridgeStore';
import { notionCreatePage } from '../../../henry/integrations';
import { actionSuccessMessage, actionErrorMessage } from '../../voice/actionVoice';
import type { ActionInput, ActionResult } from '../../types/actionTypes';

interface NotionPageInput {
  id?: string;
  url?: string;
  title?: string;
  lastEditedTime?: string;
  object?: 'page' | 'database';
  properties?: Record<string, unknown>;
}

function getPageTitle(input: NotionPageInput): string {
  if (input.title) return input.title;
  const props = input.properties ?? {};
  for (const key of Object.keys(props)) {
    const p = props[key] as any;
    if (p?.type === 'title' && Array.isArray(p.title)) {
      return p.title.map((t: any) => t.plain_text ?? '').join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

function summarizePage(input: ActionInput): Promise<ActionResult> {
  const page = input as NotionPageInput;
  const title = getPageTitle(page);

  const lines = [
    `I have a Notion page I'd like you to help me with:`,
    '',
    `Title: ${title}`,
    page.url ? `Link: ${page.url}` : null,
    page.lastEditedTime ? `Last edited: ${new Date(page.lastEditedTime).toLocaleDateString()}` : null,
    '',
    `Based on the title, what do you think this page covers? What questions would help me get the most out of it, and what should I do with this content?`,
  ].filter(Boolean);

  sendToHenry(lines.join('\n'));
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

function createPageDraft(input: ActionInput): Promise<ActionResult> {
  const pageTitle = (input.title as string) ?? '';
  const context   = (input.context as string) ?? '';
  const pageType  = (input.pageType as string) ?? 'page';

  const prompt = [
    `Help me write content for a new Notion ${pageType}.`,
    pageTitle ? `\nTitle: ${pageTitle}` : '',
    context ? `\nContext:\n${context}` : '',
    '',
    `Please draft well-structured content. Use clear headings, bullet points where helpful, and a logical flow. I'll copy it into Notion.`,
  ].join('\n');

  sendToHenry(prompt);
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

async function createPage(input: ActionInput): Promise<ActionResult> {
  const parentPageId = (input.parentPageId as string) ?? '';
  const title        = (input.title as string) ?? '';
  const lines        = (input.lines as string[]) ?? [];

  if (!parentPageId || !title) {
    return {
      success: false,
      message: 'parentPageId and title are required. Share the page with your integration first.',
    };
  }

  try {
    const page = await notionCreatePage(parentPageId, title, lines);
    return {
      success: true,
      message: actionSuccessMessage('notion.create_page', 'create'),
      data: { id: page.id, url: page.url },
    };
  } catch {
    return { success: false, message: actionErrorMessage('notion.create_page', 'create') };
  }
}

export function registerNotionHandlers() {
  registerHandler('notion.summarize_page',    summarizePage);
  registerHandler('notion.create_page_draft', createPageDraft);
  registerHandler('notion.create_page',       createPage as any);
}
