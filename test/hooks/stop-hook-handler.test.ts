import { describe, expect, it } from "bun:test";
import { getStatusMessage } from "../../src/hooks/stop-hook-handler.js";

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

		it("should return empty message for stop_hook_disabled status (silent)", () => {
			const message = getStatusMessage("stop_hook_disabled");
			expect(message).toBe("");
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

		it("should return appropriate message for validation_required status", () => {
			const message = getStatusMessage("validation_required");
			expect(message).toContain("changes detected");
		});
	});
});
