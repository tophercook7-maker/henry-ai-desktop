/**
 * Linear action handlers.
 *
 * Fully implemented:
 *   linear.summarize_issue    — summarizes a Linear issue in Henry chat
 *   linear.create_issue_draft — Henry drafts a new issue in chat
 *   linear.send_issue_to_chat — sends issue context to Henry chat
 *   linear.create_issue       — creates a real Linear issue via the GraphQL API
 */

import { registerHandler } from '../../registry/actionRegistry';
import { sendToHenry } from '../../store/chatBridgeStore';
import { linearCreateIssue } from '../../../henry/integrations';
import { actionSuccessMessage, actionErrorMessage } from '../../voice/actionVoice';
import type { ActionInput, ActionResult } from '../../types/actionTypes';

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low',
};

interface LinearIssueInput {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string;
  state?: { name?: string };
  priority?: number;
  team?: { id?: string; name?: string };
  assignee?: { name?: string; email?: string };
  labels?: { nodes?: { name: string }[] };
  url?: string;
}

function summarizeIssue(input: ActionInput): Promise<ActionResult> {
  const issue = input as LinearIssueInput;
  const priority = PRIORITY_LABELS[issue.priority ?? 0] ?? 'Unknown';
  const labels = (issue.labels?.nodes ?? []).map((l) => l.name).join(', ');

  const lines = [
    `Help me understand and act on this Linear issue:`,
    '',
    `${issue.identifier ?? 'Issue'}: ${issue.title ?? 'Untitled'}`,
    `Status: ${issue.state?.name ?? 'Unknown'}`,
    `Priority: ${priority}`,
    issue.team?.name ? `Team: ${issue.team.name}` : null,
    issue.assignee?.name ? `Assignee: ${issue.assignee.name}` : null,
    labels ? `Labels: ${labels}` : null,
    issue.url ? `Link: ${issue.url}` : null,
    issue.description ? `\nDescription:\n${issue.description.slice(0, 1000)}` : null,
    '',
    '1. What is this issue asking for?',
    '2. How should it be prioritized?',
    '3. What is the suggested next step or approach?',
  ].filter(Boolean);

  sendToHenry(lines.join('\n'));
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

function createIssueDraft(input: ActionInput): Promise<ActionResult> {
  const context  = (input.context as string) ?? '';
  const teamName = (input.teamName as string) ?? '';

  const prompt = [
    `Help me draft a Linear issue.`,
    teamName ? `Team: ${teamName}` : '',
    context ? `\nContext or problem to address:\n${context}` : '',
    '',
    `Please write a clear, actionable issue with:`,
    `- A concise title`,
    `- A description that explains what needs to be done and why`,
    `- Acceptance criteria if applicable`,
    `Keep it structured and ready to paste into Linear.`,
  ].join('\n');

  sendToHenry(prompt);
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

function sendIssueToChat(input: ActionInput): Promise<ActionResult> {
  const issue = input as LinearIssueInput;

  const lines = [
    `Here's a Linear issue I want to discuss:`,
    '',
    `${issue.identifier ?? 'Issue'}: ${issue.title ?? 'Untitled'}`,
    issue.state?.name ? `Status: ${issue.state.name}` : null,
    issue.priority !== undefined ? `Priority: ${PRIORITY_LABELS[issue.priority] ?? 'Unknown'}` : null,
    issue.description ? `\n${issue.description.slice(0, 800)}` : null,
    '',
    `What do you think about this, and what should I do next?`,
  ].filter(Boolean);

  sendToHenry(lines.join('\n'));
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

async function createIssue(input: ActionInput): Promise<ActionResult> {
  const teamId     = (input.teamId as string) ?? '';
  const title      = (input.title as string) ?? '';
  const description = (input.description as string) ?? undefined;
  const priority   = (input.priority as number) ?? undefined;

  if (!teamId || !title) {
    return { success: false, message: 'teamId and title are required to create a Linear issue.' };
  }

  try {
    const issue = await linearCreateIssue(teamId, title, description, priority);
    return {
      success: true,
      message: actionSuccessMessage('linear.create_issue', 'create'),
      data: { identifier: issue.identifier, url: issue.url, id: issue.id },
    };
  } catch {
    return { success: false, message: actionErrorMessage('linear.create_issue', 'create') };
  }
}

export function registerLinearHandlers() {
  registerHandler('linear.summarize_issue',    summarizeIssue);
  registerHandler('linear.create_issue_draft', createIssueDraft);
  registerHandler('linear.send_issue_to_chat', sendIssueToChat);
  registerHandler('linear.create_issue',       createIssue as any);
}
