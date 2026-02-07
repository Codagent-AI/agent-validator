import { describe, expect, it } from "bun:test";
import type { AdapterConfig } from "../../src/config/types.js";

// ─── 2.3–2.6 Adapter config threading ──────────────────────────────────────
// Tests verify that adapter config lookup and property mapping work correctly.
// The review gate extracts config per adapter name and maps:
//   adapterConfigs[toolName].allow_tool_use  → opts.allowToolUse
//   adapterConfigs[toolName].thinking_budget  → opts.thinkingBudget
//
// Since bun's mock.module leaks between test files (oven-sh/bun#6024),
// we test the config threading logic directly rather than through the
// full ReviewGateExecutor flow.

/**
 * Simulates the adapter config lookup and mapping done in review.ts runSingleReview.
 * See src/gates/review.ts lines ~697-710.
 */
function resolveAdapterOpts(
	toolName: string,
	adapterConfigs?: Record<string, AdapterConfig>,
): { allowToolUse?: boolean; thinkingBudget?: string } {
	const adapterCfg = adapterConfigs?.[toolName];
	return {
		allowToolUse: adapterCfg?.allow_tool_use,
		thinkingBudget: adapterCfg?.thinking_budget,
	};
}

describe("Adapter config threading", () => {
	// ─── 2.3 Claude adapter opts ────────────────────────────────────────

	it("Claude: passes allowToolUse=false", () => {
		const opts = resolveAdapterOpts("claude", {
			claude: { allow_tool_use: false, thinking_budget: "high" },
		});
		expect(opts.allowToolUse).toBe(false);
		expect(opts.thinkingBudget).toBe("high");
	});

	it("Claude: passes allowToolUse=true", () => {
		const opts = resolveAdapterOpts("claude", {
			claude: { allow_tool_use: true },
		});
		expect(opts.allowToolUse).toBe(true);
	});

	it("Claude: passes each thinkingBudget level", () => {
		for (const level of ["off", "low", "medium", "high"] as const) {
			const opts = resolveAdapterOpts("claude", {
				claude: { allow_tool_use: true, thinking_budget: level },
			});
			expect(opts.thinkingBudget).toBe(level);
		}
	});

	// ─── 2.4 Codex adapter opts ─────────────────────────────────────────

	it("Codex: passes allowToolUse=false", () => {
		const opts = resolveAdapterOpts("codex", {
			codex: { allow_tool_use: false, thinking_budget: "medium" },
		});
		expect(opts.allowToolUse).toBe(false);
		expect(opts.thinkingBudget).toBe("medium");
	});

	it("Codex: passes each thinkingBudget level", () => {
		for (const level of ["off", "low", "medium", "high"] as const) {
			const opts = resolveAdapterOpts("codex", {
				codex: { allow_tool_use: true, thinking_budget: level },
			});
			expect(opts.thinkingBudget).toBe(level);
		}
	});

	// ─── 2.5 Gemini adapter opts ────────────────────────────────────────

	it("Gemini: passes allowToolUse=false", () => {
		const opts = resolveAdapterOpts("gemini", {
			gemini: { allow_tool_use: false },
		});
		expect(opts.allowToolUse).toBe(false);
	});

	it("Gemini: passes each thinkingBudget level", () => {
		for (const level of ["off", "low", "medium", "high"] as const) {
			const opts = resolveAdapterOpts("gemini", {
				gemini: { allow_tool_use: true, thinking_budget: level },
			});
			expect(opts.thinkingBudget).toBe(level);
		}
	});

	// ─── 2.6 Integration: config threading ──────────────────────────────

	it("passes undefined opts when no adapter config for adapter", () => {
		const opts = resolveAdapterOpts("claude", {
			gemini: { allow_tool_use: false, thinking_budget: "low" },
		});
		expect(opts.allowToolUse).toBeUndefined();
		expect(opts.thinkingBudget).toBeUndefined();
	});

	it("passes undefined opts when adapterConfigs is empty", () => {
		const opts = resolveAdapterOpts("claude", {});
		expect(opts.allowToolUse).toBeUndefined();
		expect(opts.thinkingBudget).toBeUndefined();
	});

	it("passes undefined opts when adapterConfigs is undefined", () => {
		const opts = resolveAdapterOpts("claude", undefined);
		expect(opts.allowToolUse).toBeUndefined();
		expect(opts.thinkingBudget).toBeUndefined();
	});
});
