/**
 * Gmail action handlers.
 *
 * Fully implemented:
 *   gmail.draft_reply        — Henry writes a reply; saves it as a Gmail draft
 *   gmail.summarize_thread   — summarizes the email thread in Henry chat
 *   gmail.send_thread_to_chat — sends thread context to Henry chat
 *
 * Note: gmail.draft_reply uses a two-step flow:
 *   1. Henry writes the draft text (via chat)
 *   2. The draft is saved to Gmail Drafts via the API
 * If draft saving fails (e.g. expired token), the text is still in chat.
 */

import { registerHandler } from '../../registry/actionRegistry';
import { sendToHenry } from '../../store/chatBridgeStore';
import { gmailCreateDraft } from '../../../henry/integrations';
import { actionSuccessMessage, actionErrorMessage } from '../../voice/actionVoice';
import type { ActionInput, ActionResult } from '../../types/actionTypes';

function draftReply(input: ActionInput): Promise<ActionResult> {
  const subject = (input.subject as string) ?? '(no subject)';
  const from    = (input.from as string) ?? '';
  const snippet = (input.snippet as string) ?? '';
  const body    = (input.body as string) ?? snippet;

  const prompt = [
    `I received this email and need your help drafting a reply.`,
    '',
    `From: ${from}`,
    `Subject: ${subject}`,
    '',
    body,
    '',
    "Please write a professional, concise reply. Keep it warm but brief. I'll review it before sending.",
  ].join('\n');

  sendToHenry(prompt);
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

function summarizeThread(input: ActionInput): Promise<ActionResult> {
  const subject = (input.subject as string) ?? '(no subject)';
  const from    = (input.from as string) ?? '';
  const body    = (input.body as string) ?? (input.snippet as string) ?? '';

  const prompt = [
    `Summarize this email thread for me.`,
    '',
    `Subject: ${subject}`,
    `From: ${from}`,
    '',
    body,
    '',
    'Give me: (1) what this email is about, (2) what action it wants from me if any, (3) how urgent it is.',
  ].join('\n');

  sendToHenry(prompt);
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

function sendThreadToChat(input: ActionInput): Promise<ActionResult> {
  const subject = (input.subject as string) ?? '(no subject)';
  const from    = (input.from as string) ?? '';
  const body    = (input.body as string) ?? (input.snippet as string) ?? '';
  const date    = (input.date as number);
  const dateStr = date
    ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  const prompt = [
    `Here's an email I want to discuss with you:`,
    '',
    `From: ${from}${dateStr ? `  ·  ${dateStr}` : ''}`,
    `Subject: ${subject}`,
    '',
    body,
    '',
    `What should I know about this?`,
  ].join('\n');

  sendToHenry(prompt);
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

/**
 * Save a ready-to-send draft directly to Gmail Drafts.
 * Called after Henry produces draft text — the panel or UI layer supplies
 * the to/subject/body after review.
 */
async function saveDraftToGmail(input: ActionInput): Promise<ActionResult> {
  const to      = (input.to as string) ?? '';
  const subject = (input.subject as string) ?? '';
  const body    = (input.body as string) ?? '';

  if (!to || !subject || !body) {
    return { success: false, message: 'to, subject, and body are all required to save a draft.' };
  }

  try {
    const result = await gmailCreateDraft(to, subject, body);
    return {
      success: true,
      message: actionSuccessMessage('gmail.save_draft', 'send'),
      data: result,
    };
  } catch {
    return {
      success: false,
      message: actionErrorMessage('gmail.save_draft', 'send'),
    };
  }
}

export function registerGmailHandlers() {
  registerHandler('gmail.draft_reply',         draftReply);
  registerHandler('gmail.summarize_thread',    summarizeThread);
  registerHandler('gmail.send_thread_to_chat', sendThreadToChat);
  registerHandler('gmail.save_draft',          saveDraftToGmail as any);
}
