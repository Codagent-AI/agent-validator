/** Maps unified thinking budget levels to Claude MAX_THINKING_TOKENS values. */
export const CLAUDE_THINKING_TOKENS: Record<string, number> = {
  off: 0,
  low: 8000,
  medium: 16000,
  high: 31999,
};

/** Maps unified thinking budget levels to Claude Code effort levels (CLAUDE_CODE_EFFORT_LEVEL). `off` has no effort. */
export const CLAUDE_EFFORT_LEVEL: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

/** Effort levels Claude Code accepts in CLAUDE_CODE_EFFORT_LEVEL (canonical names only). */
export const CLAUDE_CODE_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

/** Maps unified thinking budget levels to Codex model_reasoning_effort values. */
export const CODEX_REASONING_EFFORT: Record<string, string> = {
  off: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

/** Maps unified thinking budget levels to Gemini thinkingBudget values. */
export const GEMINI_THINKING_BUDGET: Record<string, number> = {
  off: 0,
  low: 4096,
  medium: 8192,
  high: 24576,
};

/** Maps unified thinking budget levels to OpenCode --variant values. */
export const OPENCODE_VARIANT: Record<string, string> = {
  off: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
};
