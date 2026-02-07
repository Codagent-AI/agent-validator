import { describe, expect, it } from "bun:test";
import { CursorStopHookAdapter } from "../../../src/hooks/adapters/cursor-stop-hook.js";
import type { GauntletStatus } from "../../../src/types/gauntlet-status.js";
import type { StopHookResult } from "../../../src/hooks/adapters/types.js";

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

describe("CursorStopHookAdapter", () => {
	const adapter = new CursorStopHookAdapter();

	describe("detect()", () => {
		it("should return true for Cursor input (has cursor_version)", () => {
			const input = {
				cursor_version: "0.44.0",
				workspace_roots: ["/path/to/project"],
				loop_count: 0,
			};
			expect(adapter.detect(input)).toBe(true);
		});

		it("should return false for Claude Code input (no cursor_version)", () => {
			const input = {
				cwd: "/path/to/project",
				session_id: "session-123",
				stop_hook_active: false,
			};
			expect(adapter.detect(input)).toBe(false);
		});

		it("should return false for empty input", () => {
			expect(adapter.detect({})).toBe(false);
		});
	});

	describe("parseInput()", () => {
		it("should parse cwd from workspace_roots[0]", () => {
			const input = {
				cursor_version: "0.44.0",
				workspace_roots: ["/custom/path", "/other/path"],
			};
			const ctx = adapter.parseInput(input);
			expect(ctx.cwd).toBe("/custom/path");
		});

		it("should default cwd to process.cwd() when workspace_roots is empty", () => {
			const input = {
				cursor_version: "0.44.0",
				workspace_roots: [],
			};
			const ctx = adapter.parseInput(input);
			expect(ctx.cwd).toBe(process.cwd());
		});

		it("should default cwd to process.cwd() when workspace_roots is not provided", () => {
			const input = { cursor_version: "0.44.0" };
			const ctx = adapter.parseInput(input);
			expect(ctx.cwd).toBe(process.cwd());
		});

		it("should parse loop_count", () => {
			const input = {
				cursor_version: "0.44.0",
				loop_count: 3,
			};
			const ctx = adapter.parseInput(input);
			expect(ctx.loopCount).toBe(3);
		});

		it("should parse conversation_id as sessionId", () => {
			const input = {
				cursor_version: "0.44.0",
				conversation_id: "conv-789",
			};
			const ctx = adapter.parseInput(input);
			expect(ctx.sessionId).toBe("conv-789");
		});

		it("should set isNestedHook to false (Cursor uses loop_count)", () => {
			const input = { cursor_version: "0.44.0" };
			const ctx = adapter.parseInput(input);
			expect(ctx.isNestedHook).toBe(false);
		});

		it("should preserve rawInput", () => {
			const input = {
				cursor_version: "0.44.0",
				custom_field: "value",
			};
			const ctx = adapter.parseInput(input);
			expect(ctx.rawInput).toEqual(input);
		});
	});

	describe("formatOutput()", () => {
		it("should output systemMessage for non-blocking status", () => {
			const result = createResult({
				status: "passed",
				message: "✓ Gauntlet passed",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.systemMessage).toBe("✓ Gauntlet passed");
			expect(output.followup_message).toBeUndefined();
		});

		it("should output followup_message for failed status", () => {
			const result = createResult({
				status: "failed",
				shouldBlock: true,
				message: "✗ Gauntlet failed",
				instructions: "Fix the issues",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.followup_message).toBe("Fix the issues");
		});

		it("should output followup_message for pr_push_required status", () => {
			const result = createResult({
				status: "pr_push_required",
				shouldBlock: true,
				message: "✓ Gauntlet passed — PR needed",
				pushPRReason: "Create a PR",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.followup_message).toBe("Create a PR");
		});

		it("should output followup_message for ci_failed status with ciFixReason", () => {
			const result = createResult({
				status: "ci_failed",
				shouldBlock: true,
				ciFixReason: "Fix the CI failures",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.followup_message).toBe("Fix the CI failures");
		});

		it("should output followup_message for ci_pending status with ciPendingReason", () => {
			const result = createResult({
				status: "ci_pending",
				shouldBlock: true,
				ciPendingReason: "Wait for CI to complete",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.followup_message).toBe("Wait for CI to complete");
		});

		it("should output systemMessage for ci_passed status", () => {
			const result = createResult({
				status: "ci_passed",
				message: "✓ CI passed",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.systemMessage).toBe("✓ CI passed");
			expect(output.followup_message).toBeUndefined();
		});

		it("should output systemMessage for ci_timeout status", () => {
			const result = createResult({
				status: "ci_timeout",
				message: "⚠ CI wait exhausted",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.systemMessage).toBe("⚠ CI wait exhausted");
			expect(output.followup_message).toBeUndefined();
		});

		it("should use message as fallback when instructions not provided", () => {
			const result = createResult({
				status: "failed",
				shouldBlock: true,
				message: "✗ Gauntlet failed",
			});
			const output = JSON.parse(adapter.formatOutput(result));
			expect(output.followup_message).toBe("✗ Gauntlet failed");
		});

		it("should output single-line JSON", () => {
			const result = createResult({
				status: "failed",
				shouldBlock: true,
				instructions: "Fix the issues",
			});
			const output = adapter.formatOutput(result);
			expect(output.includes("\n")).toBe(false);
		});
	});

	describe("shouldSkipExecution()", () => {
		it("should return null when loop_count is below threshold", () => {
			const ctx = {
				cwd: "/path",
				isNestedHook: false,
				loopCount: 5,
				rawInput: {},
			};
			expect(adapter.shouldSkipExecution(ctx)).toBeNull();
		});

		it("should return null when loop_count is undefined", () => {
			const ctx = {
				cwd: "/path",
				isNestedHook: false,
				rawInput: {},
			};
			expect(adapter.shouldSkipExecution(ctx)).toBeNull();
		});

		it("should return retry_limit_exceeded when loop_count reaches threshold", () => {
			const ctx = {
				cwd: "/path",
				isNestedHook: false,
				loopCount: 10, // Default threshold
				rawInput: {},
			};
			const result = adapter.shouldSkipExecution(ctx);
			expect(result).not.toBeNull();
			expect(result?.status).toBe("retry_limit_exceeded");
			expect(result?.shouldBlock).toBe(false);
		});

		it("should return retry_limit_exceeded when loop_count exceeds threshold", () => {
			const ctx = {
				cwd: "/path",
				isNestedHook: false,
				loopCount: 15,
				rawInput: {},
			};
			const result = adapter.shouldSkipExecution(ctx);
			expect(result).not.toBeNull();
			expect(result?.status).toBe("retry_limit_exceeded");
		});
	});

	describe("custom maxLoops", () => {
		it("should respect custom maxLoops in constructor", () => {
			const customAdapter = new CursorStopHookAdapter(5);
			const ctx = {
				cwd: "/path",
				isNestedHook: false,
				loopCount: 5,
				rawInput: {},
			};
			const result = customAdapter.shouldSkipExecution(ctx);
			expect(result).not.toBeNull();
			expect(result?.status).toBe("retry_limit_exceeded");
		});

		it("should not skip when below custom maxLoops", () => {
			const customAdapter = new CursorStopHookAdapter(5);
			const ctx = {
				cwd: "/path",
				isNestedHook: false,
				loopCount: 4,
				rawInput: {},
			};
			expect(customAdapter.shouldSkipExecution(ctx)).toBeNull();
		});
	});

	describe("name property", () => {
		it("should be 'cursor'", () => {
			expect(adapter.name).toBe("cursor");
		});
	});
});
