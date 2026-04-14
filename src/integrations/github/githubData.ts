/**
 * GitHub — data layer.
 *
 * Re-exports API functions from integrations.ts.
 * The GitHub panel imports from here.
 */

export type { GHUser, GHRepo, GHIssue, GHPR } from '../../henry/integrations';
export {
  ghGetUser, ghListRepos, ghListIssues, ghListPRs, ghCreateIssue,
} from '../../henry/integrations';

/** Build a prompt for Henry to triage issues in a repo. */
export function buildTriagePrompt(
  repoFullName: string,
  issues: { number: number; state: string; title: string; labels: { name: string }[]; updated_at: string }[],
  filter: 'open' | 'closed'
): string {
  const lines = issues.slice(0, 20).map((i) => {
    const labels = i.labels.map((l) => l.name).join(', ');
    return `#${i.number} [${i.state}${labels ? ` · ${labels}` : ''}] ${i.title}`;
  });
  return [
    `Help me triage the ${filter} issues in my GitHub repo "${repoFullName}".`,
    '',
    'Issues:',
    ...lines,
    '',
    'Please:',
    '1. Group them by theme or area (bug, feature, chore, etc.)',
    '2. Flag any that look urgent or blocking',
    '3. Suggest which 3 I should tackle first and why',
  ].join('\n');
}

/** Build a prompt for Henry to review pull requests. */
export function buildPRReviewPrompt(
  repoFullName: string,
  prs: { number: number; title: string; draft?: boolean; user: { login: string }; head: { ref: string }; base: { ref: string }; created_at: string }[]
): string {
  const lines = prs.slice(0, 15).map((pr) => {
    const status = pr.draft ? 'draft' : 'open';
    return `#${pr.number} [${status}] "${pr.title}" by @${pr.user.login} (${pr.head.ref} → ${pr.base.ref})`;
  });
  return [
    `Give me a quick read on the open pull requests in "${repoFullName}".`,
    '',
    'PRs:',
    ...lines,
    '',
    'Flag any that look stale, risky, or need immediate review. Which one should I look at first?',
  ].join('\n');
}
