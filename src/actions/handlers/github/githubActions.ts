/**
 * GitHub action handlers.
 *
 * Implemented:
 *   github.summarize_pr     — summarizes a PR in Henry chat
 *   github.summarize_issue  — summarizes an issue in Henry chat
 *   github.create_issue     — creates a GitHub issue (write + confirmation-gated)
 */

import { registerHandler } from '../../registry/actionRegistry';
import { sendToHenry } from '../../store/chatBridgeStore';
import { ghCreateIssue } from '../../../henry/integrations';
import { actionSuccessMessage, actionErrorMessage } from '../../voice/actionVoice';
import type { ActionInput, ActionResult } from '../../types/actionTypes';

interface PRInput {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  draft?: boolean;
  user?: { login?: string };
  head?: { ref?: string };
  base?: { ref?: string };
  labels?: { name: string }[];
  created_at?: string;
  updated_at?: string;
  repo?: string;
}

interface IssueInput {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  labels?: { name: string }[];
  user?: { login?: string };
  created_at?: string;
  comments?: number;
  repo?: string;
}

function summarizePR(input: ActionInput): Promise<ActionResult> {
  const pr = input as PRInput;
  const labels = (pr.labels ?? []).map((l) => l.name).join(', ');
  const status = pr.draft ? 'Draft PR' : `${pr.state ?? 'open'} PR`;

  const lines = [
    `Summarize this GitHub pull request and tell me what I need to know:`,
    '',
    `Repo: ${pr.repo ?? 'unknown'}`,
    `PR #${pr.number}: ${pr.title ?? 'Untitled'}`,
    `Status: ${status}`,
    pr.user?.login ? `Author: @${pr.user.login}` : null,
    pr.head?.ref && pr.base?.ref ? `Branch: ${pr.head.ref} → ${pr.base.ref}` : null,
    labels ? `Labels: ${labels}` : null,
    pr.body ? `\nDescription:\n${pr.body.slice(0, 1000)}` : null,
    '',
    '1. What does this PR change or add?',
    '2. What should I review or watch out for?',
    '3. Is it ready to merge? What might be missing?',
  ].filter(Boolean);

  sendToHenry(lines.join('\n'));
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

function summarizeIssue(input: ActionInput): Promise<ActionResult> {
  const issue = input as IssueInput;
  const labels = (issue.labels ?? []).map((l) => l.name).join(', ');

  const lines = [
    `Summarize and triage this GitHub issue:`,
    '',
    `Repo: ${issue.repo ?? 'unknown'}`,
    `Issue #${issue.number}: ${issue.title ?? 'Untitled'}`,
    `Status: ${issue.state ?? 'open'}`,
    issue.user?.login ? `Opened by: @${issue.user.login}` : null,
    labels ? `Labels: ${labels}` : null,
    issue.comments !== undefined ? `Comments: ${issue.comments}` : null,
    issue.body ? `\nDescription:\n${issue.body.slice(0, 1200)}` : null,
    '',
    '1. What is this issue about?',
    '2. How severe or urgent is it?',
    '3. What is the likely fix or next step?',
  ].filter(Boolean);

  sendToHenry(lines.join('\n'));
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

async function createIssue(input: ActionInput): Promise<ActionResult> {
  const repo   = (input.repo as string) ?? '';
  const title  = (input.title as string) ?? '';
  const body   = (input.body as string) ?? '';
  const labels = (input.labels as string[]) ?? [];

  if (!repo || !title) {
    return { success: false, message: 'repo (owner/name) and title are required.' };
  }

  try {
    const issue = await ghCreateIssue(repo, title, body, labels);
    return {
      success: true,
      message: actionSuccessMessage('github.create_issue', 'create'),
      data: issue,
    };
  } catch {
    return { success: false, message: actionErrorMessage('github.create_issue', 'create') };
  }
}

export function registerGithubHandlers() {
  registerHandler('github.summarize_pr',    summarizePR);
  registerHandler('github.summarize_issue', summarizeIssue);
  registerHandler('github.create_issue',    createIssue);
}
