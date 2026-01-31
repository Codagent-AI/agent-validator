import type {
	StopHookAdapter,
	StopHookContext,
	StopHookResult,
} from "./types.js";

/**
 * Cursor hook response format.
 * - Empty object {} = allow stop (no feedback)
 * - { systemMessage: "..." } = allow stop with user-visible message
 * - { followup_message: "..." } = block stop and continue with message
 */
interface CursorHookResponse {
	followup_message?: string;
	systemMessage?: string;
}

/**
 * Default maximum loop count before allowing stop.
 * Cursor has built-in loop_limit (default 5, configurable in hooks.json),
 * but we provide defense-in-depth with our own check.
 */
const DEFAULT_MAX_LOOPS = 10;

/**
 * Adapter for Cursor IDE stop hook protocol.
 *
 * Cursor protocol:
 * - Input: { status, loop_count, cursor_version, workspace_roots, conversation_id, ... }
 * - Output: { followup_message?: "..." } or {}
 * - Block mechanism: { followup_message: "instructions" } - continues agent with message
 * - Allow mechanism: {} (empty object) - allows stop
 * - Loop prevention: loop_count field (Cursor has built-in loop_limit)
 */
export class CursorStopHookAdapter implements StopHookAdapter {
	name = "cursor";

	/**
	 * Maximum loop count before forcing stop.
	 * Can be configured via hooks.json loop_limit.
	 */
	private maxLoops: number;

	constructor(maxLoops: number = DEFAULT_MAX_LOOPS) {
		this.maxLoops = maxLoops;
	}

	/**
	 * Detect if this adapter should handle the given input.
	 * Cursor sends cursor_version in hook input.
	 */
	detect(raw: Record<string, unknown>): boolean {
		return "cursor_version" in raw;
	}

	/**
	 * Parse Cursor input into normalized context.
	 */
	parseInput(raw: Record<string, unknown>): StopHookContext {
		const workspaceRoots = raw.workspace_roots;
		const loopCount = raw.loop_count as number | undefined;

		return {
			cwd:
				(Array.isArray(workspaceRoots) ? workspaceRoots[0] : null) ??
				process.cwd(),
			isNestedHook: false, // Cursor uses loop_count instead of nested hook flag
			loopCount,
			sessionId: raw.conversation_id as string | undefined,
			rawInput: raw,
		};
	}

	/**
	 * Get the block message for a given result based on status.
	 */
	private getBlockMessage(result: StopHookResult): string {
		const messageMap: Record<string, string | undefined> = {
			failed: result.instructions,
			pr_push_required: result.pushPRReason,
			ci_failed: result.ciFixReason,
			ci_pending: result.ciPendingReason,
		};
		return messageMap[result.status] || result.message;
	}

	/**
	 * Format handler result into Cursor protocol output.
	 */
	formatOutput(result: StopHookResult): string {
		if (result.shouldBlock) {
			const response: CursorHookResponse = {
				followup_message: this.getBlockMessage(result),
			};
			return JSON.stringify(response);
		}

		// Include systemMessage for user feedback even when not blocking
		const response: CursorHookResponse = {
			systemMessage: result.message,
		};
		return JSON.stringify(response);
	}

	/**
	 * Check if execution should be skipped based on Cursor-specific conditions.
	 * Returns early if loop_count exceeds threshold.
	 */
	shouldSkipExecution(ctx: StopHookContext): StopHookResult | null {
		// Cursor has built-in loop_limit (default 5), but we can check here too
		// for defense-in-depth
		if (ctx.loopCount !== undefined && ctx.loopCount >= this.maxLoops) {
			return {
				status: "retry_limit_exceeded",
				shouldBlock: false,
				message:
					"Loop limit reached — run `agent-gauntlet clean` to archive and continue.",
			};
		}
		return null;
	}
}
