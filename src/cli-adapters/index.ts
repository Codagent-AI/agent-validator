// Re-export shared types and utilities (used by adapter implementations)
export {
  type CLIAdapter,
  type CLIAdapterHealth,
  collectStderr,
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

export {
  GeminiAdapter,
  CodexAdapter,
  ClaudeAdapter,
  GitHubCopilotAdapter,
  CursorAdapter,
  OpenCodeAdapter,
};

// Adapter registry: keys should use lowercase with hyphens for multi-word names
const adapters: Record<string, CLIAdapter> = {
  gemini: new GeminiAdapter(),
  codex: new CodexAdapter(),
  claude: new ClaudeAdapter(),
  'github-copilot': new GitHubCopilotAdapter(),
  cursor: new CursorAdapter(),
  opencode: new OpenCodeAdapter(),
};

export function getAdapter(name: string): CLIAdapter | undefined {
  return adapters[name];
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

/**
 * Returns all valid CLI tool names (adapter registry keys).
 */
export function getValidCLITools(): string[] {
  return Object.keys(adapters);
}
