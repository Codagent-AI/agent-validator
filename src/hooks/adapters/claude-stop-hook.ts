import type {
	StopHookAdapter,
	StopHookContext,
	StopHookResult,
} from "./types.js";

/**
 * Claude Code hook response format.
 */
interface ClaudeHookResponse {
	decision: "block" | "approve";
	reason?: string;
	stopReason?: string;
	systemMessage?: string;
	status: string;
	message?: string;
}

/**
 * Adapter for Claude Code stop hook protocol.
 *
 * Claude Code protocol:
 * - Input: { cwd, stop_hook_active, session_id, transcript_path, hook_event_name, permission_mode }
 * - Output: { decision: "block"|"approve", reason?, stopReason, systemMessage?, status, message }
 * - Block mechanism: decision: "block" with reason (fed back to Claude as prompt)
 * - Allow mechanism: decision: "approve"
 */
export class ClaudeStopHookAdapter implements StopHookAdapter {
	name = "claude";

	/**
	 * Detect if this adapter should handle the given input.
	 * Claude Code doesn't send cursor_version, so we detect by absence.
	 */
	detect(raw: Record<string, unknown>): boolean {
		// Claude Code doesn't send cursor_version
		return !("cursor_version" in raw);
	}

	/**
	 * Parse Claude Code input into normalized context.
	 */
	parseInput(raw: Record<string, unknown>): StopHookContext {
		return {
			cwd: (raw.cwd as string) ?? process.cwd(),
			isNestedHook: raw.stop_hook_active === true,
			sessionId: raw.session_id as string | undefined,
			rawInput: raw,
		};
	}

	/**
	 * Get the block reason for a given result based on status.
	 */
	private getBlockReason(result: StopHookResult): string | undefined {
		return result.reason;
	}

	/**
	 * Format handler result into Claude Code protocol output.
	 */
	formatOutput(result: StopHookResult): string {
		const blockReason = this.getBlockReason(result);
		const stopReason =
			result.shouldBlock && blockReason ? blockReason : result.message;

		const response: ClaudeHookResponse = {
			decision: result.shouldBlock ? "block" : "approve",
			status: result.status,
		};

		if (stopReason) response.stopReason = stopReason;
		if (result.message) {
			response.systemMessage = result.message;
			response.message = result.message;
		}
		if (result.shouldBlock && blockReason) {
			response.reason = blockReason;
		}

		return JSON.stringify(response);
	}

	/**
	 * Check if execution should be skipped based on Claude-specific conditions.
	 * Note: stop_hook_active from stdin is currently disabled in the main entry point
	 * because Claude Code sends it after blocking twice, but we need to re-run.
	 */
	shouldSkipExecution(_ctx: StopHookContext): StopHookResult | null {
		// The isNestedHook check is handled at the entry point level
		// via the marker file mechanism, not here.
		// This method is available for future protocol-specific skip conditions.
		return null;
	}
}
