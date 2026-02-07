import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	adapterConfigSchema,
	cliConfigSchema,
} from "../../src/config/schema.js";
import {
	CLAUDE_THINKING_TOKENS,
	CODEX_REASONING_EFFORT,
	GEMINI_THINKING_BUDGET,
} from "../../src/cli-adapters/thinking-budget.js";

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
		for (const level of ["off", "low", "medium", "high"]) {
			const result = adapterConfigSchema.parse({ thinking_budget: level });
			expect(result.thinking_budget).toBe(level);
		}
	});

	it("rejects invalid thinking_budget values", () => {
		expect(() =>
			adapterConfigSchema.parse({ thinking_budget: "extreme" }),
		).toThrow();
		expect(() =>
			adapterConfigSchema.parse({ thinking_budget: 42 }),
		).toThrow();
	});

	it("rejects non-boolean allow_tool_use", () => {
		expect(() =>
			adapterConfigSchema.parse({ allow_tool_use: "yes" }),
		).toThrow();
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

	afterEach(async () => {
		try {
			await fs.unlink(settingsPath);
		} catch {
			// Ignore
		}
	});

	it("creates and cleans up settings.json when none existed", async () => {
		try {
			await fs.unlink(settingsPath);
		} catch {
			// Ignore
		}

		// Import the real GeminiAdapter class directly
		const { GeminiAdapter } = await import(
			"../../src/cli-adapters/gemini.js"
		);
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

		const { GeminiAdapter } = await import(
			"../../src/cli-adapters/gemini.js"
		);
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
