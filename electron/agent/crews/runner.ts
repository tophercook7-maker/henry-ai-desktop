/**
 * Crew runner (build plan, Phase 2). Runs a crew's agents in sequence on the
 * worker engine, chaining each agent's output into the next. Each agent runs
 * through the existing `runToolConversation` loop with a registry filtered to
 * just the tools that agent is allowed to use — so the safety gate, retry, and
 * audit logging all apply unchanged, and confirm-tier actions still pause for
 * the user even mid-crew.
 */

import { ToolRegistry, registry as globalRegistry } from '../toolRegistry';
import { runToolConversation, type RunnerMessage, type ModelCompletion } from '../toolRunner';
import type { ModelTool, AgentContext } from '../types';
import { callAIWithTools } from '../../ipc/ai';
import type { Crew, CrewAgent, CrewRunResult, CrewRunStep } from './types';

/** Build a registry containing only the tools this agent may use. */
function subRegistry(agent: CrewAgent): ToolRegistry {
  const r = new ToolRegistry();
  const names = new Set(agent.tools ?? []);
  const cats = new Set(agent.categories ?? []);
  if (names.size === 0 && cats.size === 0) return r; // pure-reasoning agent — no tools
  const allowed = globalRegistry
    .getAllTools()
    .filter((t) => names.has(t.name) || cats.has(t.category));
  r.registerAll(allowed);
  return r;
}

export interface RunCrewDeps {
  db: AgentContext['db'];
  getWindow: AgentContext['getWindow'];
  engine: { provider: string; model: string; apiKey: string };
  /** Optional progress callback (per agent finishing). */
  onStep?: (step: CrewRunStep) => void;
}

export async function runCrew(crew: Crew, input: string, deps: RunCrewDeps): Promise<CrewRunResult> {
  const steps: CrewRunStep[] = [];
  const usage = { input: 0, output: 0 };
  let prior = '';

  for (const agent of crew.agents) {
    const registry = subRegistry(agent);
    const context: AgentContext = { db: deps.db, getWindow: deps.getWindow };

    const system = [
      agent.systemPrompt,
      `\nCrew goal: ${crew.goal}`,
      `Your role: ${agent.role}`,
      `Your goal: ${agent.goal}`,
      prior ? `\nWork from the earlier agents:\n${prior}` : '',
      `\nDo your part and only your part. Be concise and concrete — hand the next agent something they can build on.`,
    ]
      .filter(Boolean)
      .join('\n');

    const messages: RunnerMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: input },
    ];

    const complete = (msgs: RunnerMessage[], modelTools: ModelTool[]): Promise<ModelCompletion> =>
      callAIWithTools({
        provider: deps.engine.provider,
        model: deps.engine.model,
        apiKey: deps.engine.apiKey,
        messages: msgs,
        modelTools,
      });

    let step: CrewRunStep;
    try {
      const result = await runToolConversation({
        registry,
        context,
        messages,
        complete,
        maxRounds: agent.maxRounds ?? 6,
      });
      step = { agent: agent.name, output: result.content, rounds: result.rounds, usage: result.usage };
      usage.input += result.usage.input;
      usage.output += result.usage.output;
    } catch (e) {
      step = {
        agent: agent.name,
        output: `⚠️ ${agent.name} failed: ${e instanceof Error ? e.message : String(e)}`,
        rounds: 0,
        usage: { input: 0, output: 0 },
      };
    }

    steps.push(step);
    deps.onStep?.(step);
    prior = `${prior ? prior + '\n\n' : ''}## ${agent.name}\n${step.output}`;
  }

  return { crew: crew.name, steps, final: steps[steps.length - 1]?.output ?? '', usage };
}
