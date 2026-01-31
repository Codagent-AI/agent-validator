import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { WaitCIResult } from "../../src/commands/wait-ci.js";
import {
	cleanCIWaitAttempts,
	getCIFixInstructions,
	getCIPendingInstructions,
	getPushPRInstructions,
	getStatusMessage,
	getStopReasonInstructions,
	MAX_CI_WAIT_ATTEMPTS,
	readCIWaitAttempts,
	writeCIWaitAttempts,
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

	describe("getCIFixInstructions()", () => {
		it("should include failed checks section", () => {
			const ciResult: WaitCIResult = {
				ci_status: "failed",
				failed_checks: [
					{
						name: "build",
						conclusion: "failure",
						details_url: "https://example.com/build",
					},
				],
				review_comments: [],
				elapsed_seconds: 30,
			};
			const instructions = getCIFixInstructions(ciResult);
			expect(instructions).toContain("CI FAILED");
			expect(instructions).toContain("**Failed checks:**");
			expect(instructions).toContain("build");
			expect(instructions).toContain("https://example.com/build");
		});

		it("should include review comments section", () => {
			const ciResult: WaitCIResult = {
				ci_status: "failed",
				failed_checks: [],
				review_comments: [
					{
						author: "reviewer",
						body: "Please fix this issue",
						path: "src/index.ts",
						line: 10,
					},
				],
				elapsed_seconds: 30,
			};
			const instructions = getCIFixInstructions(ciResult);
			expect(instructions).toContain("**Review comments requiring changes:**");
			expect(instructions).toContain("reviewer");
			expect(instructions).toContain("Please fix this issue");
			expect(instructions).toContain("src/index.ts:10");
		});

		it("should include fix and push guidance", () => {
			const ciResult: WaitCIResult = {
				ci_status: "failed",
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: 30,
			};
			const instructions = getCIFixInstructions(ciResult);
			expect(instructions).toContain("Fix the issues");
			expect(instructions).toContain("push your changes");
			expect(instructions).toContain("try to stop again");
		});

		it("should handle both failed checks and review comments", () => {
			const ciResult: WaitCIResult = {
				ci_status: "failed",
				failed_checks: [
					{
						name: "lint",
						conclusion: "failure",
						details_url: "https://example.com/lint",
					},
				],
				review_comments: [
					{
						author: "reviewer",
						body: "Add tests",
					},
				],
				elapsed_seconds: 30,
			};
			const instructions = getCIFixInstructions(ciResult);
			expect(instructions).toContain("**Failed checks:**");
			expect(instructions).toContain("**Review comments requiring changes:**");
		});
	});

	describe("getCIPendingInstructions()", () => {
		it("should include attempt count", () => {
			const instructions = getCIPendingInstructions(1, 3);
			expect(instructions).toContain("attempt 1 of 3");
		});

		it("should include wait guidance", () => {
			const instructions = getCIPendingInstructions(2, 3);
			expect(instructions).toContain("CI CHECKS STILL RUNNING");
			expect(instructions).toContain("Wait approximately 30 seconds");
			expect(instructions).toContain("try to stop again");
		});

		it("should use MAX_CI_WAIT_ATTEMPTS constant", () => {
			const instructions = getCIPendingInstructions(1, MAX_CI_WAIT_ATTEMPTS);
			expect(instructions).toContain(`attempt 1 of ${MAX_CI_WAIT_ATTEMPTS}`);
		});
	});

	describe("CI wait attempts marker file", () => {
		const testLogDir = path.join(process.cwd(), `test-ci-wait-${Date.now()}`);

		beforeEach(async () => {
			await fs.mkdir(testLogDir, { recursive: true });
		});

		afterEach(async () => {
			await fs.rm(testLogDir, { recursive: true, force: true });
		});

		describe("readCIWaitAttempts()", () => {
			it("should return 0 when marker file does not exist", async () => {
				const count = await readCIWaitAttempts(testLogDir);
				expect(count).toBe(0);
			});

			it("should return count from marker file", async () => {
				await fs.writeFile(
					path.join(testLogDir, ".ci-wait-attempts"),
					JSON.stringify({ count: 2 }),
				);
				const count = await readCIWaitAttempts(testLogDir);
				expect(count).toBe(2);
			});

			it("should return 0 for invalid JSON", async () => {
				await fs.writeFile(
					path.join(testLogDir, ".ci-wait-attempts"),
					"invalid json",
				);
				const count = await readCIWaitAttempts(testLogDir);
				expect(count).toBe(0);
			});
		});

		describe("writeCIWaitAttempts()", () => {
			it("should write count to marker file", async () => {
				await writeCIWaitAttempts(testLogDir, 3);
				const content = await fs.readFile(
					path.join(testLogDir, ".ci-wait-attempts"),
					"utf-8",
				);
				expect(JSON.parse(content)).toEqual({ count: 3 });
			});

			it("should overwrite existing marker file", async () => {
				await writeCIWaitAttempts(testLogDir, 1);
				await writeCIWaitAttempts(testLogDir, 2);
				const content = await fs.readFile(
					path.join(testLogDir, ".ci-wait-attempts"),
					"utf-8",
				);
				expect(JSON.parse(content)).toEqual({ count: 2 });
			});
		});

		describe("cleanCIWaitAttempts()", () => {
			it("should remove marker file", async () => {
				await fs.writeFile(
					path.join(testLogDir, ".ci-wait-attempts"),
					JSON.stringify({ count: 1 }),
				);
				await cleanCIWaitAttempts(testLogDir);
				const exists = await fs
					.stat(path.join(testLogDir, ".ci-wait-attempts"))
					.then(() => true)
					.catch(() => false);
				expect(exists).toBe(false);
			});

			it("should not throw when marker file does not exist", async () => {
				// Should not throw
				await cleanCIWaitAttempts(testLogDir);
			});
		});
	});

	describe("CI status messages", () => {
		it("should return appropriate message for ci_pending status", () => {
			const message = getStatusMessage("ci_pending");
			expect(message).toContain("CI checks still running");
		});

		it("should return appropriate message for ci_failed status", () => {
			const message = getStatusMessage("ci_failed");
			expect(message).toContain("CI failed");
		});

		it("should return appropriate message for ci_passed status", () => {
			const message = getStatusMessage("ci_passed");
			expect(message).toContain("CI passed");
		});

		it("should return appropriate message for ci_timeout status", () => {
			const message = getStatusMessage("ci_timeout");
			expect(message).toContain("CI wait exhausted");
		});
	});
});
