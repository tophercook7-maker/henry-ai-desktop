/**
 * Agent Crews (build plan, Phase 2) — CrewAI-inspired role teams.
 *
 * A Crew is an ordered set of agents that run one after another on a shared
 * goal: each agent has its own role, persona, and a restricted set of tools,
 * and it sees the previous agents' output. The whole crew runs on Henry's
 * existing tool-runner + safety gate, so confirm-tier actions still pause for
 * the user even inside a crew.
 */

import type { ToolCategory } from '../types';

/** One agent in a crew: a role + goal + the tools it's allowed to touch. */
export interface CrewAgent {
  /** Stable id within the crew. */
  id: string;
  /** Display name, e.g. "Lead Finder". */
  name: string;
  /** One-line role. */
  role: string;
  /** What this agent must accomplish. */
  goal: string;
  /** Persona / instructions injected as the agent's system prompt. */
  systemPrompt: string;
  /**
   * Tool access. A global tool is allowed if its name is in `tools` OR its
   * category is in `categories`. If both are empty the agent runs with no
   * tools (pure reasoning) — the safe default.
   */
  tools?: string[];
  categories?: ToolCategory[];
  /** Tool-loop cap for this agent (default 6). */
  maxRounds?: number;
}

/** A named team of agents run in sequence on a shared goal. */
export interface Crew {
  id: string;
  name: string;
  description: string;
  goal: string;
  agents: CrewAgent[];
}

/** Lightweight crew view for the renderer (no system prompts). */
export interface CrewSummary {
  id: string;
  name: string;
  description: string;
  goal: string;
  agents: Array<{ id: string; name: string; role: string; goal: string }>;
}

export interface CrewRunStep {
  agent: string;
  output: string;
  rounds: number;
  usage: { input: number; output: number };
}

export interface CrewRunResult {
  crew: string;
  steps: CrewRunStep[];
  /** The last agent's output — the crew's deliverable. */
  final: string;
  usage: { input: number; output: number };
}
