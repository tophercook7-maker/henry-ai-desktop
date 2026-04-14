/**
 * Linear — data layer.
 *
 * Re-exports API functions from integrations.ts.
 * The Linear panel imports from here.
 */

export type { LinearIssue } from '../../henry/integrations';
export { linearGetMyIssues } from '../../henry/integrations';

export function priorityIcon(priority: number): string {
  return ['', '🔴', '🟠', '🔵', '⚪', '⚪'][priority] || '⚪';
}

export function priorityLabel(priority: number): string {
  return ['', 'Urgent', 'High', 'Medium', 'Low', 'No priority'][priority] || 'No priority';
}

/** Group a flat list of issues by their team name. */
export function groupByTeam<T extends { team: { name: string } }>(
  issues: T[]
): Record<string, T[]> {
  return issues.reduce<Record<string, T[]>>((acc, issue) => {
    const team = issue.team.name;
    if (!acc[team]) acc[team] = [];
    acc[team].push(issue);
    return acc;
  }, {});
}
