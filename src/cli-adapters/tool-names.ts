/** Supported names for the adapter registry and config validation. */
export const VALID_CLI_TOOLS = [
  'gemini',
  'codex',
  'claude',
  'github-copilot',
  'cursor',
  'opencode',
] as const;

export function getValidCLITools(): string[] {
  return [...VALID_CLI_TOOLS];
}
