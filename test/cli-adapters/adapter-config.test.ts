import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	CLAUDE_EFFORT_LEVEL,
	CLAUDE_THINKING_TOKENS,
	CODEX_REASONING_EFFORT,
	GEMINI_THINKING_BUDGET,
} from "../../src/cli-adapters/thinking-budget.js";
import { resolveClaudeThinkingLaunch } from "../../src/cli-adapters/claude.js";
import { createUnavailableTelemetry } from "../../src/cli-adapters/shared.js";
import {
	adapterConfigSchema,
	cliConfigSchema,
} from "../../src/config/schema.js";

// ─── 2.1 Adapter config schema validation ──────────────────────────────────

describe("adapterConfigSchema", () => {
	it("accepts valid config with both fields", () => {
		const result = adapterConfigSchema.parse({
			allow_tool_use: false,
			thinking_budget: "high",
		});
		expect(result.allow_tool_use).toBe(false);
		expect(result.thinking_budget).toBe("high");
	});

	it("defaults allow_tool_use to true", () => {
		const result = adapterConfigSchema.parse({});
		expect(result.allow_tool_use).toBe(true);
		expect(result.thinking_budget).toBeUndefined();
	});

	it("accepts all valid thinking_budget levels", () => {
		const validLevels = ["off", "low", "medium", "high"] as const;
		for (const level of validLevels) {
			const result = adapterConfigSchema.parse({ thinking_budget: level });
			expect(result.thinking_budget).toBe(level);
		}
	});

	it("rejects invalid thinking_budget values", () => {
		expect(() =>
			adapterConfigSchema.parse({ thinking_budget: "extreme" }),
		).toThrow();
		expect(() => adapterConfigSchema.parse({ thinking_budget: 42 })).toThrow();
	});

	it("rejects non-boolean allow_tool_use", () => {
		expect(() =>
			adapterConfigSchema.parse({ allow_tool_use: "yes" }),
		).toThrow();
	});

	it("accepts optional model string", () => {
		const result = adapterConfigSchema.parse({ model: "codex" });
		expect(result.model).toBe("codex");
	});

	it("defaults model to undefined when not provided", () => {
		const result = adapterConfigSchema.parse({});
		expect(result.model).toBeUndefined();
	});

	it("rejects non-string model", () => {
		expect(() => adapterConfigSchema.parse({ model: 42 })).toThrow();
	});
});

describe("cliConfigSchema with adapters", () => {
	it("accepts config without adapters", () => {
		const result = cliConfigSchema.parse({
			default_preference: ["claude"],
		});
		expect(result.adapters).toBeUndefined();
	});

	it("accepts config with adapters section", () => {
		const result = cliConfigSchema.parse({
			default_preference: ["claude", "gemini"],
			adapters: {
				claude: { allow_tool_use: true, thinking_budget: "high" },
				gemini: { allow_tool_use: false, thinking_budget: "medium" },
			},
		});
		expect(result.adapters?.claude?.allow_tool_use).toBe(true);
		expect(result.adapters?.gemini?.thinking_budget).toBe("medium");
	});

	it("accepts empty adapters record", () => {
		const result = cliConfigSchema.parse({
			default_preference: ["claude"],
			adapters: {},
		});
		expect(result.adapters).toEqual({});
	});

	it("accepts config with model in adapter settings", () => {
		const result = cliConfigSchema.parse({
			default_preference: ["cursor"],
			adapters: {
				cursor: {
					allow_tool_use: false,
					thinking_budget: "low",
					model: "codex",
				},
			},
		});
		expect(result.adapters?.cursor?.model).toBe("codex");
	});
});

// ─── 2.2 Thinking budget maps ──────────────────────────────────────────────

describe("thinking budget maps", () => {
	const levels = ["off", "low", "medium", "high"];

	it("CLAUDE_THINKING_TOKENS maps all levels to numbers", () => {
		for (const level of levels) {
			expect(typeof CLAUDE_THINKING_TOKENS[level]).toBe("number");
		}
		expect(CLAUDE_THINKING_TOKENS.off).toBe(0);
		expect(CLAUDE_THINKING_TOKENS.low).toBe(8000);
		expect(CLAUDE_THINKING_TOKENS.medium).toBe(16000);
		expect(CLAUDE_THINKING_TOKENS.high).toBe(31999);
	});

	it("maps Claude effort only for low, medium, and high", () => {
		expect(CLAUDE_EFFORT_LEVEL).toEqual({ low: "low", medium: "medium", high: "high" });
		expect(Object.hasOwn(CLAUDE_EFFORT_LEVEL, "off")).toBe(false);
	});

	it("resolves configured Claude launch controls", () => {
		for (const [level, tokens] of [["low", "8000"], ["medium", "16000"], ["high", "31999"]] as const) {
			expect(resolveClaudeThinkingLaunch(level, { CLAUDE_CODE_EFFORT_LEVEL: "max" })).toEqual({
				thinkingEnv: { CLAUDE_CODE_EFFORT_LEVEL: level, MAX_THINKING_TOKENS: tokens },
				resolvedEffort: level,
			});
		}
		expect(resolveClaudeThinkingLaunch("off", {})).toEqual({ thinkingEnv: { MAX_THINKING_TOKENS: "0" }, resolvedEffort: null });
		expect(resolveClaudeThinkingLaunch(undefined, {})).toEqual({ thinkingEnv: {}, resolvedEffort: null });
		expect(resolveClaudeThinkingLaunch("off", { CLAUDE_CODE_EFFORT_LEVEL: "high" }).resolvedEffort).toBe("high");
	});

	it("recognizes only canonical inherited Claude efforts without rewriting them", () => {
		for (const value of ["medium", "MEDIUM", "xhigh", "max"]) {
			const result = resolveClaudeThinkingLaunch(undefined, { CLAUDE_CODE_EFFORT_LEVEL: value });
			expect(result).toEqual({ thinkingEnv: {}, resolvedEffort: value.toLowerCase() });
		}
		for (const value of ["", "auto", "unset", " medium ", "med", "3", "bogus"]) {
			expect(resolveClaudeThinkingLaunch(undefined, { CLAUDE_CODE_EFFORT_LEVEL: value })).toEqual({ thinkingEnv: {}, resolvedEffort: null });
		}
		expect(resolveClaudeThinkingLaunch("constructor", {})).toEqual({ thinkingEnv: {}, resolvedEffort: null });
	});

	it("separates requested and explicitly resolved effort", () => {
		const explicit = createUnavailableTelemetry("claude", { requestedEffort: "off", resolvedEffort: null });
		expect(explicit.requested_identity.effort).toBe("off");
		expect(explicit.resolved_identity.effort).toBeNull();
		expect(createUnavailableTelemetry("cursor", { requestedEffort: "low" }).resolved_identity.effort).toBe("low");
	});

	it("CODEX_REASONING_EFFORT maps all levels to strings", () => {
		for (const level of levels) {
			expect(typeof CODEX_REASONING_EFFORT[level]).toBe("string");
		}
		expect(CODEX_REASONING_EFFORT.off).toBe("minimal");
		expect(CODEX_REASONING_EFFORT.low).toBe("low");
		expect(CODEX_REASONING_EFFORT.medium).toBe("medium");
		expect(CODEX_REASONING_EFFORT.high).toBe("high");
	});

	it("GEMINI_THINKING_BUDGET maps all levels to numbers", () => {
		for (const level of levels) {
			expect(typeof GEMINI_THINKING_BUDGET[level]).toBe("number");
		}
		expect(GEMINI_THINKING_BUDGET.off).toBe(0);
		expect(GEMINI_THINKING_BUDGET.low).toBe(4096);
		expect(GEMINI_THINKING_BUDGET.medium).toBe(8192);
		expect(GEMINI_THINKING_BUDGET.high).toBe(24576);
	});
});

// ─── 2.3–2.6 Adapter config threading tests are in adapter-config-threading.test.ts ──

// ─── 2.5 Additional: Gemini settings.json backup/restore ───────────────────

describe("GeminiAdapter applyThinkingSettings", () => {
	const settingsDir = path.join(process.cwd(), ".gemini");
	const settingsPath = path.join(settingsDir, "settings.json");
	let originalSettings: string | null = null;
	let hadOriginalSettings = false;

	beforeEach(async () => {
		try {
			originalSettings = await fs.readFile(settingsPath, "utf-8");
			hadOriginalSettings = true;
		} catch {
			originalSettings = null;
			hadOriginalSettings = false;
		}
	});

	afterEach(async () => {
		if (hadOriginalSettings && originalSettings !== null) {
			await fs.mkdir(settingsDir, { recursive: true });
			await fs.writeFile(settingsPath, originalSettings);
		} else {
			await fs.unlink(settingsPath).catch(() => {});
		}
	});

	it("creates and cleans up settings.json when none existed", async () => {
		try {
			await fs.unlink(settingsPath);
		} catch {
			// Ignore
		}

		// Import the real GeminiAdapter class directly
		const { GeminiAdapter } = await import("../../src/cli-adapters/gemini.js");
		const adapter = new GeminiAdapter();

		// biome-ignore lint/suspicious/noExplicitAny: Testing private method
		const cleanup = await (adapter as any).applyThinkingSettings(24576);

		const content = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
		expect(content.thinkingConfig.thinkingBudget).toBe(24576);

		await cleanup();

		let exists = true;
		try {
			await fs.access(settingsPath);
		} catch {
			exists = false;
		}
		expect(exists).toBe(false);
	});

	it("preserves existing settings.json after cleanup", async () => {
		await fs.mkdir(settingsDir, { recursive: true });
		const original = JSON.stringify({ existingKey: "value" });
		await fs.writeFile(settingsPath, original);

		const { GeminiAdapter } = await import("../../src/cli-adapters/gemini.js");
		const adapter = new GeminiAdapter();

		// biome-ignore lint/suspicious/noExplicitAny: Testing private method
		const cleanup = await (adapter as any).applyThinkingSettings(8192);

		const content = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
		expect(content.existingKey).toBe("value");
		expect(content.thinkingConfig.thinkingBudget).toBe(8192);

		await cleanup();

		const restored = await fs.readFile(settingsPath, "utf-8");
		expect(restored).toBe(original);
	});
});
