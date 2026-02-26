import { describe, expect, it } from "bun:test";
import { ClaudeStopHookAdapter } from "../../../src/hooks/adapters/claude-stop-hook.js";
import type { StopHookResult } from "../../../src/hooks/adapters/types.js";
import type { GauntletStatus } from "../../../src/types/gauntlet-status.js";

/**
 * Factory for creating test StopHookResult objects with sensible defaults.
 */
function createResult(
	overrides: Partial<StopHookResult> & { status: GauntletStatus },
): StopHookResult {
	return {
		shouldBlock: false,
		message: `Status: ${overrides.status}`,
		...overrides,
	};
}

describe("ClaudeStopHookAdapter", () => {
	const adapter = new ClaudeStopHookAdapter();

	describe("detect()", () => {
		it("should return true for Claude Code input (no cursor_version)", () => {
			const input = {
				cwd: "/path/to/project",
				session_id: "session-123",
				stop_hook_active: false,
				hook_event_name: "Stop",
			};
			expect(adapter.detect(input)).toBe(true);
		});

		it("should return false for Cursor input (has cursor_version)", () => {
			const input = {
				cursor_version: "0.44.0",
				workspace_roots: ["/path/to/project"],
				loop_count: 0,
			};
			expect(adapter.detect(input)).toBe(false);
		});

		it("should return true for empty input (default to Claude)", () => {
			expect(adapter.detect({})).toBe(true);
		});
	});

	describe("parseInput()", () => {
		it("should parse cwd from input", () => {
			const input = { cwd: "/custom/path" };
			const ctx = adapter.parseInput(input);
			expect(ctx.cwd).toBe("/custom/path");
		});

		it("should default cwd to process.cwd() when not provided", () => {
			const input = {};
			const ctx = adapter.parseInput(input);
			expect(ctx.cwd).toBe(process.cwd());
		});

		it("should parse stop_hook_active as isNestedHook", () => {
			const input = { stop_hook_active: true };
			const ctx = adapter.parseInput(input);
			expect(ctx.isNestedHook).toBe(true);
		});

		it("should default isNestedHook to false", () => {
			const input = {};
			const ctx = adapter.parseInput(input);
			expect(ctx.isNestedHook).toBe(false);
		});

		it("should parse session_id", () => {
			const input = { session_id: "sess-456" };
			const ctx = adapter.parseInput(input);
			expect(ctx.sessionId).toBe("sess-456");
		});

		it("should preserve rawInput", () => {
			const input = { cwd: "/path", custom_field: "value" };
			const ctx = adapter.parseInput(input);
			expect(ctx.rawInput).toEqual(input);
		});
	});

	describe("formatOutput()", () => {
		it("should output approve decision for non-blocking status", () => {
			const result = createResult({
				status: "passed",
				message: "✓ Gauntlet passed",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.decision).toBe("approve");
			expect(output.status).toBe("passed");
			expect(output.message).toBe("✓ Gauntlet passed");
		});

		it.each([
			{ status: "failed" as GauntletStatus, reason: "Fix the issues" },
		])("should output block decision for $status status", ({
			status,
			reason,
		}) => {
			const result = createResult({
				status,
				shouldBlock: true,
				reason,
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.decision).toBe("block");
			expect(output.status).toBe(status);
			expect(output.reason).toBe(reason);
			expect(output.stopReason).toBe(reason);
		});

		it("should output block decision for validation_required status", () => {
			const result = createResult({
				status: "validation_required",
				shouldBlock: true,
				reason: "Use gauntlet-run skill",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.decision).toBe("block");
			expect(output.reason).toBe("Use gauntlet-run skill");
		});

		it("should include systemMessage for all statuses", () => {
			const result = createResult({
				status: "no_config",
				message: "○ Not a gauntlet project",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.systemMessage).toBe("○ Not a gauntlet project");
		});

		it("should use message as stopReason when not blocking", () => {
			const result = createResult({
				status: "passed",
				message: "✓ Gauntlet passed",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.stopReason).toBe("✓ Gauntlet passed");
		});

		it("should output single-line JSON", () => {
			const result = createResult({
				status: "passed",
				message: "✓ Gauntlet passed",
			});
			const output = adapter.formatOutput(result);
			expect(output.includes("\n")).toBe(false);
		});
	});

	describe("shouldSkipExecution()", () => {
		it("should return null (no skip) for normal context", () => {
			const ctx = {
				cwd: "/path",
				isNestedHook: false,
				rawInput: {},
			};
			expect(adapter.shouldSkipExecution(ctx)).toBeNull();
		});

		it("should return null even for nested hook (handled at entry point)", () => {
			// The isNestedHook check is handled at the entry point level
			// via the marker file mechanism, not in the adapter
			const ctx = {
				cwd: "/path",
				isNestedHook: true,
				rawInput: {},
			};
			expect(adapter.shouldSkipExecution(ctx)).toBeNull();
		});
	});

	describe("name property", () => {
		it("should be 'claude'", () => {
			expect(adapter.name).toBe("claude");
		});
	});
});
