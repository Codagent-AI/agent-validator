/** Maps unified thinking budget levels to Claude MAX_THINKING_TOKENS values. */
export const CLAUDE_THINKING_TOKENS: Record<string, number> = {
	off: 0,
	low: 8000,
	medium: 16000,
	high: 31999,
};

/** Maps unified thinking budget levels to Codex model_reasoning_effort values. */
export const CODEX_REASONING_EFFORT: Record<string, string> = {
	off: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
};

/** Maps unified thinking budget levels to Gemini thinkingBudget values. */
export const GEMINI_THINKING_BUDGET: Record<string, number> = {
	off: 0,
	low: 4096,
	medium: 8192,
	high: 24576,
};
