import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	findPreviousFailures,
	type PreviousFailuresResult,
} from "../../src/utils/log-parser.js";

describe("Skip Passed Reviews", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "agent-validator-test-skip-passed-"),
		);
	});

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	describe("findPreviousFailures with passedSlots", () => {
		it("returns correct passed slots with iteration numbers and adapter", async () => {
			// Create a passed review log with @1 pattern
			await fs.writeFile(
				path.join(testDir, "review_src_code-quality_claude@1.2.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "pass",
					rawOutput: "LGTM",
					violations: [],
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			expect(result.failures).toEqual([]);
			expect(result.passedSlots.size).toBe(1);
			// jobId is "review_src_code-quality" (adapter is stripped)
			const passedSlot = result.passedSlots
				.get("review_src_code-quality")
				?.get(1);
			expect(passedSlot?.passIteration).toBe(2);
			expect(passedSlot?.adapter).toBe("claude");
		});

		it("Scenario 1: num_reviews=2 with 1 pass + 1 fail returns only failed slot", async () => {
			// Slot 1 passed in iteration 1
			await fs.writeFile(
				path.join(testDir, "review_src_quality_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "pass",
					rawOutput: "",
					violations: [],
				}),
			);

			// Slot 2 failed in iteration 1
			await fs.writeFile(
				path.join(testDir, "review_src_quality_gemini@2.1.json"),
				JSON.stringify({
					adapter: "gemini",
					timestamp: "2026-01-24T12:00:00Z",
					status: "fail",
					rawOutput: "",
					violations: [
						{
							file: "src/app.ts",
							line: 10,
							issue: "Missing error handling",
							priority: "high",
							status: "new",
						},
					],
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			// Should have one failure from slot 2
			expect(result.failures.length).toBe(1);
			expect(result.failures[0].adapterFailures[0].reviewIndex).toBe(2);
			expect(result.failures[0].adapterFailures[0].violations.length).toBe(1);

			// Should have one passed slot (slot 1, iteration 1, claude)
			expect(result.passedSlots.size).toBe(1);
			const passedSlot = result.passedSlots.get("review_src_quality")?.get(1);
			expect(passedSlot?.passIteration).toBe(1);
			expect(passedSlot?.adapter).toBe("claude");
		});

		it("Scenario 2: slot skipped across multiple iterations", async () => {
			// Slot 1 passed in iteration 1
			await fs.writeFile(
				path.join(testDir, "review_src_quality_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "pass",
					rawOutput: "",
					violations: [],
				}),
			);

			// Slot 2 still failing in iteration 3 (latest)
			await fs.writeFile(
				path.join(testDir, "review_src_quality_gemini@2.3.json"),
				JSON.stringify({
					adapter: "gemini",
					timestamp: "2026-01-24T14:00:00Z",
					status: "fail",
					rawOutput: "",
					violations: [
						{
							file: "src/app.ts",
							line: 10,
							issue: "Still failing",
							priority: "high",
							status: "new",
						},
					],
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			// Slot 1 should still show as passed from iteration 1
			const passedSlot = result.passedSlots.get("review_src_quality")?.get(1);
			expect(passedSlot?.passIteration).toBe(1);
			expect(passedSlot?.adapter).toBe("claude");

			// Slot 2 should be in failures
			expect(result.failures.length).toBe(1);
			expect(result.failures[0].adapterFailures[0].reviewIndex).toBe(2);
		});

		it("Scenario 3: all slots passed (safety latch scenario)", async () => {
			// Slot 1 passed in iteration 1
			await fs.writeFile(
				path.join(testDir, "review_src_quality_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "pass",
					rawOutput: "",
					violations: [],
				}),
			);

			// Slot 2 passed in iteration 2
			await fs.writeFile(
				path.join(testDir, "review_src_quality_gemini@2.2.json"),
				JSON.stringify({
					adapter: "gemini",
					timestamp: "2026-01-24T13:00:00Z",
					status: "pass",
					rawOutput: "",
					violations: [],
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			// No failures
			expect(result.failures.length).toBe(0);

			// Both slots passed
			expect(result.passedSlots.size).toBe(1);
			const jobSlots = result.passedSlots.get("review_src_quality");
			expect(jobSlots?.get(1)?.passIteration).toBe(1);
			expect(jobSlots?.get(1)?.adapter).toBe("claude");
			expect(jobSlots?.get(2)?.passIteration).toBe(2);
			expect(jobSlots?.get(2)?.adapter).toBe("gemini");
		});

		it("Scenario 4: num_reviews=1 still runs (invariant check)", async () => {
			// Single slot passed
			await fs.writeFile(
				path.join(testDir, "review_src_quality_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "pass",
					rawOutput: "",
					violations: [],
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			// Slot 1 shows as passed (skip logic happens in execute, not here)
			const passedSlot = result.passedSlots.get("review_src_quality")?.get(1);
			expect(passedSlot?.passIteration).toBe(1);
			expect(passedSlot?.adapter).toBe("claude");
		});

		it("Scenario 5: different review gates are independent", async () => {
			// code-quality gate passed
			await fs.writeFile(
				path.join(testDir, "review_src_code-quality_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "pass",
					rawOutput: "",
					violations: [],
				}),
			);

			// security gate failed
			await fs.writeFile(
				path.join(testDir, "review_src_security_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "fail",
					rawOutput: "",
					violations: [
						{
							file: "src/auth.ts",
							line: 5,
							issue: "Hardcoded credentials",
							priority: "critical",
							status: "new",
						},
					],
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			// code-quality passed
			const passedSlot = result.passedSlots
				.get("review_src_code-quality")
				?.get(1);
			expect(passedSlot?.passIteration).toBe(1);
			expect(passedSlot?.adapter).toBe("claude");

			// security failed
			expect(result.failures.length).toBe(1);
			expect(result.failures[0].jobId).toBe("review_src_security");
		});

		it("Scenario 6: adapter changes but slot still tracked by review index", async () => {
			// Slot 1 passed with claude
			await fs.writeFile(
				path.join(testDir, "review_src_quality_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "pass",
					rawOutput: "",
					violations: [],
				}),
			);

			// Slot 2 failed with gemini (but could be any adapter)
			await fs.writeFile(
				path.join(testDir, "review_src_quality_gemini@2.1.json"),
				JSON.stringify({
					adapter: "gemini",
					timestamp: "2026-01-24T12:00:00Z",
					status: "fail",
					rawOutput: "",
					violations: [
						{
							file: "src/app.ts",
							line: 10,
							issue: "Issue",
							priority: "high",
							status: "new",
						},
					],
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			// Slot 1 passed (with claude adapter tracked)
			const passedSlot = result.passedSlots.get("review_src_quality")?.get(1);
			expect(passedSlot?.passIteration).toBe(1);
			expect(passedSlot?.adapter).toBe("claude");

			// Slot 2 failed
			expect(result.failures[0].adapterFailures[0].reviewIndex).toBe(2);
		});

		it("Scenario 11: slot with no prior log files must run", async () => {
			// Only slot 1 has logs, slot 2 has no logs yet
			await fs.writeFile(
				path.join(testDir, "review_src_quality_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "fail",
					rawOutput: "",
					violations: [
						{
							file: "src/app.ts",
							line: 10,
							issue: "Issue",
							priority: "high",
							status: "new",
						},
					],
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			// Slot 1 is a failure
			expect(result.failures.length).toBe(1);

			// Slot 2 has no passed entry (no log file = must run)
			expect(
				result.passedSlots.get("review_src_quality")?.get(2),
			).toBeUndefined();
		});

		it("Scenario 12: skipped slot JSON has skipped_prior_pass status", async () => {
			// Create a skipped slot JSON
			const skippedJson = {
				adapter: "claude",
				timestamp: "2026-01-24T12:00:00Z",
				status: "skipped_prior_pass",
				rawOutput: "",
				violations: [],
				passIteration: 1,
			};

			await fs.writeFile(
				path.join(testDir, "review_src_quality_claude@1.2.json"),
				JSON.stringify(skippedJson),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			// Skipped slots should not appear as failures
			expect(result.failures.length).toBe(0);
		});

		it("treats preserved_one_shot JSON as a passed slot", async () => {
			await fs.writeFile(
				path.join(testDir, "review_src_task-compliance_claude@1.2.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "preserved_one_shot",
					rawOutput: "",
					violations: [
						{
							file: "src/app.ts",
							line: 10,
							issue: "Accepted skipped risk",
							priority: "medium",
							status: "skipped",
						},
					],
					preservedFromIteration: 1,
				}),
			);

			const result = (await findPreviousFailures(
				testDir,
				undefined,
				true,
			)) as PreviousFailuresResult;

			expect(result.failures.length).toBe(0);
			const passedSlot = result.passedSlots
				.get("review_src_task-compliance")
				?.get(1);
			expect(passedSlot?.passIteration).toBe(2);
			expect(passedSlot?.adapter).toBe("claude");
		});
	});

	describe("backwards compatibility", () => {
		it("findPreviousFailures without includePassedSlots returns array", async () => {
			await fs.writeFile(
				path.join(testDir, "review_src_quality_claude@1.1.json"),
				JSON.stringify({
					adapter: "claude",
					timestamp: "2026-01-24T12:00:00Z",
					status: "fail",
					rawOutput: "",
					violations: [
						{
							file: "src/app.ts",
							line: 10,
							issue: "Issue",
							priority: "high",
							status: "new",
						},
					],
				}),
			);

			const result = await findPreviousFailures(testDir);

			// Should return array (not object with failures/passedSlots)
			expect(Array.isArray(result)).toBe(true);
			expect((result as unknown[]).length).toBe(1);
		});
	});
});
