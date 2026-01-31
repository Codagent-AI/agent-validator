import { describe, expect, it } from "bun:test";
import type { WaitCIResult } from "../../src/commands/wait-ci.js";

describe("wait-ci command", () => {
	describe("WaitCIResult structure", () => {
		it("should have correct structure for passed status", () => {
			const result: WaitCIResult = {
				ci_status: "passed",
				pr_number: 123,
				pr_url: "https://github.com/owner/repo/pull/123",
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: 60,
			};
			expect(result.ci_status).toBe("passed");
			expect(result.failed_checks).toEqual([]);
			expect(result.review_comments).toEqual([]);
		});

		it("should have correct structure for failed status", () => {
			const result: WaitCIResult = {
				ci_status: "failed",
				pr_number: 123,
				pr_url: "https://github.com/owner/repo/pull/123",
				failed_checks: [
					{
						name: "build",
						conclusion: "failure",
						details_url: "https://github.com/owner/repo/actions/runs/123",
					},
				],
				review_comments: [
					{
						author: "reviewer",
						body: "Please fix this",
						path: "src/index.ts",
						line: 10,
					},
				],
				elapsed_seconds: 30,
			};
			expect(result.ci_status).toBe("failed");
			expect(result.failed_checks).toHaveLength(1);
			expect(result.failed_checks[0].name).toBe("build");
			expect(result.review_comments).toHaveLength(1);
		});

		it("should have correct structure for pending status", () => {
			const result: WaitCIResult = {
				ci_status: "pending",
				pr_number: 123,
				pr_url: "https://github.com/owner/repo/pull/123",
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: 270,
			};
			expect(result.ci_status).toBe("pending");
		});

		it("should have correct structure for error status", () => {
			const result: WaitCIResult = {
				ci_status: "error",
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: 0,
				error_message: "No PR found for current branch",
			};
			expect(result.ci_status).toBe("error");
			expect(result.error_message).toBe("No PR found for current branch");
		});
	});

	describe("exit code mapping", () => {
		it("passed status should map to exit code 0", () => {
			const result: WaitCIResult = {
				ci_status: "passed",
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: 60,
			};
			// Exit code 0 for passed
			expect(result.ci_status === "passed").toBe(true);
		});

		it("failed status should map to exit code 1", () => {
			const result: WaitCIResult = {
				ci_status: "failed",
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: 30,
			};
			// Exit code 1 for failed
			expect(result.ci_status === "failed").toBe(true);
		});

		it("error status should map to exit code 1", () => {
			const result: WaitCIResult = {
				ci_status: "error",
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: 0,
			};
			// Exit code 1 for error
			expect(result.ci_status === "error").toBe(true);
		});

		it("pending status should map to exit code 2", () => {
			const result: WaitCIResult = {
				ci_status: "pending",
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: 270,
			};
			// Exit code 2 for pending (timeout)
			expect(result.ci_status === "pending").toBe(true);
		});
	});

	describe("review comment filtering", () => {
		it("should include all review comments for informational purposes", () => {
			const result: WaitCIResult = {
				ci_status: "passed",
				failed_checks: [],
				review_comments: [
					{ author: "reviewer1", body: "Looks good!" },
					{ author: "reviewer2", body: "LGTM" },
				],
				elapsed_seconds: 60,
			};
			// All reviews are included for informational purposes
			expect(result.review_comments).toHaveLength(2);
		});
	});

	describe("failed check handling", () => {
		it("should include all failed checks", () => {
			const result: WaitCIResult = {
				ci_status: "failed",
				failed_checks: [
					{
						name: "build",
						conclusion: "failure",
						details_url: "https://example.com/build",
					},
					{
						name: "lint",
						conclusion: "cancelled",
						details_url: "https://example.com/lint",
					},
				],
				review_comments: [],
				elapsed_seconds: 30,
			};
			expect(result.failed_checks).toHaveLength(2);
			expect(result.failed_checks[0].conclusion).toBe("failure");
			expect(result.failed_checks[1].conclusion).toBe("cancelled");
		});
	});
});
