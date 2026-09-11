export type AdapterInitDefaults = {
  allow_tool_use: boolean;
  thinking_budget: 'low' | 'medium' | 'high';
  model?: string;
};

export const ADAPTER_CONFIG: Record<string, AdapterInitDefaults> = {
  claude: { allow_tool_use: false, thinking_budget: 'high' },
  codex: { allow_tool_use: false, thinking_budget: 'medium' },
  gemini: { allow_tool_use: false, thinking_budget: 'low' },
  cursor: { allow_tool_use: false, thinking_budget: 'low', model: 'codex' },
  'github-copilot': {
    allow_tool_use: false,
    thinking_budget: 'low',
    model: 'codex',
  },
  opencode: { allow_tool_use: false, thinking_budget: 'low' },
};
