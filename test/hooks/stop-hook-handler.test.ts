import { describe, expect, it } from "bun:test";
import {
	getStatusMessage,
	getStopReasonInstructions,
	getPushPRInstructions,
} from "../../src/hooks/stop-hook-handler.js";

describe("StopHookHandler", () => {
	describe("getStatusMessage()", () => {
		it("should return appropriate message for passed status", () => {
			const message = getStatusMessage("passed");
			expect(message).toBe(
				"✓ Gauntlet passed — all gates completed successfully.",
			);
		});

		it("should return appropriate message for passed_with_warnings status", () => {
			const message = getStatusMessage("passed_with_warnings");
			expect(message).toBe(
				"✓ Gauntlet completed — passed with warnings (some issues were skipped).",
			);
		});

		it("should return appropriate message for no_applicable_gates status", () => {
			const message = getStatusMessage("no_applicable_gates");
			expect(message).toBe(
				"✓ Gauntlet passed — no applicable gates matched current changes.",
			);
		});

		it("should return appropriate message for no_changes status", () => {
			const message = getStatusMessage("no_changes");
			expect(message).toBe("✓ Gauntlet passed — no changes detected.");
		});

		it("should return appropriate message for failed status", () => {
			const message = getStatusMessage("failed");
			expect(message).toBe(
				"✗ Gauntlet failed — issues must be fixed before stopping.",
			);
		});

		it("should return appropriate message for pr_push_required status", () => {
			const message = getStatusMessage("pr_push_required");
			expect(message).toBe(
				"✓ Gauntlet passed — PR needs to be created or updated before stopping.",
			);
		});

		it("should return appropriate message for retry_limit_exceeded status", () => {
			const message = getStatusMessage("retry_limit_exceeded");
			expect(message).toContain("retry limit exceeded");
			expect(message).toContain("agent-gauntlet clean");
		});

		it("should return appropriate message for lock_conflict status", () => {
			const message = getStatusMessage("lock_conflict");
			expect(message).toContain("already in progress");
		});

		it("should return appropriate message for no_config status", () => {
			const message = getStatusMessage("no_config");
			expect(message).toContain("Not a gauntlet project");
		});

		it("should return appropriate message for stop_hook_active status", () => {
			const message = getStatusMessage("stop_hook_active");
			expect(message).toContain("Stop hook cycle detected");
		});

		it("should return appropriate message for stop_hook_disabled status", () => {
			const message = getStatusMessage("stop_hook_disabled");
			expect(message).toContain("Stop hook is disabled");
		});

		it("should include interval minutes in interval_not_elapsed message", () => {
			const message = getStatusMessage("interval_not_elapsed", {
				intervalMinutes: 10,
			});
			expect(message).toContain("10 min");
		});

		it("should include error message in error status", () => {
			const message = getStatusMessage("error", {
				errorMessage: "Something went wrong",
			});
			expect(message).toContain("Something went wrong");
		});

		it("should return appropriate message for invalid_input status", () => {
			const message = getStatusMessage("invalid_input");
			expect(message).toContain("Invalid hook input");
		});
	});

	describe("getStopReasonInstructions()", () => {
		it("should include urgent fix directive", () => {
			const instructions = getStopReasonInstructions(undefined);
			expect(instructions).toContain("GAUNTLET FAILED");
			expect(instructions).toContain("YOU MUST FIX ISSUES NOW");
		});

		it("should include termination conditions", () => {
			const instructions = getStopReasonInstructions(undefined);
			expect(instructions).toContain("Status: Passed");
			expect(instructions).toContain("Status: Passed with warnings");
			expect(instructions).toContain("Status: Retry limit exceeded");
		});

		it("should list failed check log paths", () => {
			const gateResults = [
				{
					jobId: "check:root:eslint",
					status: "fail" as const,
					logPath: "/path/to/check.log",
				},
			];
			const instructions = getStopReasonInstructions(gateResults);
			expect(instructions).toContain("**Failed gate logs:**");
			expect(instructions).toContain("Check: `/path/to/check.log`");
		});

		it("should list failed review json paths", () => {
			const gateResults = [
				{
					jobId: "review:src:claude-review",
					status: "fail" as const,
					subResults: [
						{
							nameSuffix: "(claude@1)",
							status: "fail" as const,
							logPath: "/path/to/review.json",
						},
					],
				},
			];
			const instructions = getStopReasonInstructions(gateResults);
			expect(instructions).toContain("**Failed gate logs:**");
			expect(instructions).toContain("Review: `/path/to/review.json`");
		});

		it("should include trust level guidance for review failures", () => {
			const gateResults = [
				{
					jobId: "review:src:claude-review",
					status: "fail" as const,
					subResults: [
						{
							nameSuffix: "(claude@1)",
							status: "fail" as const,
							logPath: "/path/to/review.json",
						},
					],
				},
			];
			const instructions = getStopReasonInstructions(gateResults);
			expect(instructions).toContain("Review trust level: medium");
		});

		it("should not include trust level guidance for check-only failures", () => {
			const gateResults = [
				{
					jobId: "check:root:eslint",
					status: "fail" as const,
					logPath: "/path/to/check.log",
				},
			];
			const instructions = getStopReasonInstructions(gateResults);
			expect(instructions).not.toContain("Review trust level");
		});

		it("should include violation handling instructions for review failures", () => {
			const gateResults = [
				{
					jobId: "review:src:claude-review",
					status: "fail" as const,
					subResults: [
						{
							nameSuffix: "(claude@1)",
							status: "fail" as const,
							logPath: "/path/to/review.json",
						},
					],
				},
			];
			const instructions = getStopReasonInstructions(gateResults);
			expect(instructions).toContain("For REVIEW violations");
			expect(instructions).toContain('"status": "fixed"');
			expect(instructions).toContain('"status": "skipped"');
		});
	});

	describe("getPushPRInstructions()", () => {
		it("should include PR creation instructions", () => {
			const instructions = getPushPRInstructions();
			expect(instructions).toContain("GAUNTLET PASSED");
			expect(instructions).toContain("pull request");
		});

		it("should include instruction to try stopping again", () => {
			const instructions = getPushPRInstructions();
			expect(instructions).toContain("try to stop again");
		});

		it("should include skipped issues guidance when passed_with_warnings", () => {
			const instructions = getPushPRInstructions({ hasWarnings: true });
			expect(instructions).toContain("skipped issues");
			expect(instructions).toContain("PR description");
		});

		it("should not include skipped issues guidance for clean pass", () => {
			const instructions = getPushPRInstructions({ hasWarnings: false });
			expect(instructions).not.toContain("skipped issues");
		});

		it("should not include skipped issues guidance by default", () => {
			const instructions = getPushPRInstructions();
			expect(instructions).not.toContain("skipped issues");
		});
	});
});
