// Re-export shared types and utilities (used by adapter implementations)
export {
  AdapterExecutionFailure,
  type AdapterExecutionResult,
  type AdapterTelemetry,
  type CLIAdapter,
  type CLIAdapterHealth,
  collectStderr,
  createUnavailableTelemetry,
  finalizeProcessClose,
  isUsageLimit,
  processExitError,
  runStreamingCommand,
} from './shared.js';

import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { CursorAdapter } from './cursor.js';
import { GeminiAdapter } from './gemini.js';
import { GitHubCopilotAdapter } from './github-copilot.js';
import { OpenCodeAdapter } from './opencode.js';
import type { CLIAdapter } from './shared.js';
import type { CLIToolName } from './tool-names.js';

export {
  GeminiAdapter,
  CodexAdapter,
  ClaudeAdapter,
  GitHubCopilotAdapter,
  CursorAdapter,
  OpenCodeAdapter,
};

// Adapter registry: keys should use lowercase with hyphens for multi-word names
// Keyed by CLIToolName so the compiler keeps this registry and VALID_CLI_TOOLS in sync.
const adapters: Record<CLIToolName, CLIAdapter> = {
  gemini: new GeminiAdapter(),
  codex: new CodexAdapter(),
  claude: new ClaudeAdapter(),
  'github-copilot': new GitHubCopilotAdapter(),
  cursor: new CursorAdapter(),
  opencode: new OpenCodeAdapter(),
};

export function getAdapter(name: string): CLIAdapter | undefined {
  return Object.hasOwn(adapters, name)
    ? adapters[name as CLIToolName]
    : undefined;
}

export function getAllAdapters(): CLIAdapter[] {
  return Object.values(adapters);
}

/**
 * Returns all adapters that support project-scoped commands.
 */
export function getProjectCommandAdapters(): CLIAdapter[] {
  return Object.values(adapters).filter(
    (a) => a.getProjectCommandDir() !== null,
  );
}

/**
 * Returns all adapters that support user-level commands.
 */
export function getUserCommandAdapters(): CLIAdapter[] {
  return Object.values(adapters).filter((a) => a.getUserCommandDir() !== null);
}

export { getValidCLITools } from './tool-names.js';
