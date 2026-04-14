/**
 * Slack — data layer.
 *
 * Re-exports API functions from integrations.ts.
 * The Slack panel imports from here.
 */

export type { SlackChannel, SlackMessage } from '../../henry/integrations';
export { slackListChannels, slackGetHistory, slackPostMessage } from '../../henry/integrations';

/** Build a prompt asking Henry to summarize Slack channel activity. */
export function buildSummarizePrompt(
  channelName: string,
  messages: { username?: string; user?: string; text: string }[]
): string {
  const recent = [...messages].reverse().slice(-30);
  const transcript = recent
    .map((m) => `${m.username || m.user || 'Unknown'}: ${m.text}`)
    .join('\n');
  return [
    `I need you to summarize and surface what matters from my Slack channel #${channelName}.`,
    '',
    'Here are the most recent messages:',
    '---',
    transcript,
    '---',
    'Give me:',
    "1. A 2-sentence summary of what's being discussed",
    '2. Any decisions made or action items I should be aware of',
    '3. Anything that requires my response or attention',
    "Keep it tight — I'm scanning, not reading.",
  ].join('\n');
}
