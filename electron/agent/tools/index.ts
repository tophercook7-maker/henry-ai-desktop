/**
 * Central tool registration (design §1 "Tool Registration at Startup").
 *
 * Every shipped tool kit is imported and registered here so callers — chiefly
 * `electron/ipc/agent.ts` — only need `registerAllTools(registry)`. Tools take
 * no construction-time context: the runtime `AgentContext` (db, window,
 * sessionId) is handed to each tool's `execute` by the ToolRunner.
 *
 *   Sprint 1: memory, finance
 *   Sprint 2: calendar, messages, email (macOS automation) + permissions_check
 */

import type { ToolRegistry } from "../toolRegistry";
import { memoryTools } from "./memory";
import { financeTools } from "./finance";
import { calendarTools } from "./calendar";
import { messagesTools } from "./messages";
import { emailTools } from "./email";
import { permissionsTools } from "./permissions";

export function registerAllTools(registry: ToolRegistry): void {
  registry.registerAll([
    ...memoryTools(),
    ...financeTools(),
    ...calendarTools(),
    ...messagesTools(),
    ...emailTools(),
    ...permissionsTools(),
  ]);
}
