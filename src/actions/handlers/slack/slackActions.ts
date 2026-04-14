/**
 * Slack action handlers.
 *
 * Implemented:
 *   slack.summarize_channel   — summarizes recent channel messages in Henry chat
 *   slack.send_thread_to_chat — sends a thread transcript to Henry chat
 *   slack.compose_message     — Henry drafts a Slack message in chat
 *   slack.send_message        — sends a message to a Slack channel (write + confirm)
 */

import { registerHandler } from '../../registry/actionRegistry';
import { sendToHenry } from '../../store/chatBridgeStore';
import { slackPostMessage } from '../../../henry/integrations';
import { actionSuccessMessage, actionErrorMessage } from '../../voice/actionVoice';
import type { ActionInput, ActionResult } from '../../types/actionTypes';

interface SlackMessage {
  text: string;
  username?: string;
  user?: string;
  ts?: string;
}

function summarizeChannel(input: ActionInput): Promise<ActionResult> {
  const channelName = (input.channelName as string) ?? 'this channel';
  const messages    = (input.messages as SlackMessage[]) ?? [];

  if (messages.length === 0) {
    sendToHenry(`The Slack channel #${channelName} has no recent messages. What would you recommend I post to start a conversation?`);
    return Promise.resolve({ success: true });
  }

  const recent = [...messages].reverse().slice(-30);
  const transcript = recent
    .map((m) => `${m.username || m.user || 'Someone'}: ${m.text}`)
    .join('\n');

  const prompt = [
    `Summarize and surface what matters in my Slack channel #${channelName}:`,
    '',
    transcript,
    '',
    '1. What is being discussed? (2 sentences)',
    '2. Any decisions or action items I should know about?',
    '3. Anything that needs my response or attention?',
    'Keep it tight.',
  ].join('\n');

  sendToHenry(prompt);
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

function sendThreadToChat(input: ActionInput): Promise<ActionResult> {
  const channelName = (input.channelName as string) ?? 'Slack';
  const messages    = (input.messages as SlackMessage[]) ?? [];

  if (messages.length === 0) {
    return Promise.resolve({ success: false, message: 'No messages to send.' });
  }

  const transcript = messages
    .map((m) => `${m.username || m.user || 'Unknown'}: ${m.text}`)
    .join('\n');

  const prompt = [
    `Here's a Slack thread from #${channelName} I want to discuss:`,
    '',
    transcript,
    '',
    `What's going on here and what should I do?`,
  ].join('\n');

  sendToHenry(prompt);
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

function composeMessage(input: ActionInput): Promise<ActionResult> {
  const channelName = (input.channelName as string) ?? 'this channel';
  const context     = (input.context as string) ?? '';

  const prompt = [
    `Help me write a Slack message for #${channelName}.`,
    context ? `\nContext: ${context}` : '',
    '',
    `Write a clear, professional Slack message. Keep it brief and scannable. I'll review and send it.`,
  ].join('\n');

  sendToHenry(prompt);
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

async function sendMessage(input: ActionInput): Promise<ActionResult> {
  const channelId = input.channelId as string;
  const text      = input.text as string;

  if (!channelId || !text) {
    return { success: false, message: 'Channel ID and message text are required.' };
  }

  try {
    await slackPostMessage(channelId, text);
    return { success: true, message: actionSuccessMessage('slack.send_message', 'send') };
  } catch {
    return { success: false, message: actionErrorMessage('slack.send_message', 'send') };
  }
}

export function registerSlackHandlers() {
  registerHandler('slack.summarize_channel',   summarizeChannel);
  registerHandler('slack.send_thread_to_chat', sendThreadToChat);
  registerHandler('slack.compose_message',     composeMessage);
  registerHandler('slack.send_message',        sendMessage);
}
