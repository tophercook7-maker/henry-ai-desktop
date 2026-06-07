/**
 * Registers every shipped tool against the singleton registry at startup.
 * Sprint 1 ships the memory and finance kits; calendar, communication,
 * system, and external kits land in later sprints.
 */

import { registry } from './toolRegistry';
import { memoryTools } from './tools/memory';
import { financeTools } from './tools/finance';
import type { AgentContext } from './types';

export function registerAllTools(context: AgentContext): void {
  registry.registerAll([...memoryTools(context), ...financeTools(context)]);
}
