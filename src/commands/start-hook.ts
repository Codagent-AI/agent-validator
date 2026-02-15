import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import YAML from "yaml";
import { loadGlobalConfig } from "../config/global.js";
import { getDebugLogConfig, getLogDir } from "../hooks/stop-hook-handler.js";
import { DebugLogger, mergeDebugLogConfig } from "../utils/debug-log.js";

const START_HOOK_MESSAGE = `<IMPORTANT>
This project uses Agent Gauntlet for automated quality verification.

BEFORE reporting any coding task as complete, you MUST run /gauntlet-run
to verify your changes pass all quality gates.

Run /gauntlet-run when ALL of these are true:
  1. You completed a coding task (implemented a feature, fixed a bug,
     refactored code, or made other substantive code changes)
  2. You are about to report the work as done, complete, or fixed

Do NOT run /gauntlet-run when:
  - You only answered questions, explored code, or ran read-only commands
  - You are in the middle of a multi-step task (run it at the end, not
    after every individual change)
  - The user explicitly asked to skip verification

If you are unsure whether to run it, run it. False positives (running
unnecessarily) are far less costly than false negatives (skipping
verification on code that needed it).
</IMPORTANT>`;

function formatClaudeOutput(message: string): string {
	return JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: message,
		},
	});
}

function formatCursorOutput(message: string): string {
	return message;
}

/**
 * Validate that the config file contains parseable YAML with at least some content.
 * Returns true if valid, false if empty or invalid.
 */
function isValidConfig(content: string): boolean {
	const trimmed = content.trim();
	if (!trimmed) {
		return false;
	}
	try {
		const parsed = YAML.parse(trimmed);
		// YAML.parse returns null for empty documents, undefined for some edge cases
		return parsed != null && typeof parsed === "object";
	} catch {
		return false;
	}
}

export function registerStartHookCommand(program: Command): void {
	program
		.command("start-hook")
		.description(
			"Session start hook - primes agent with gauntlet verification instructions",
		)
		.option("--adapter <adapter>", "Output format: claude or cursor", "claude")
		.action(async (options: { adapter: string }) => {
			// Fast exit if not a gauntlet project
			const configPath = path.join(process.cwd(), ".gauntlet", "config.yml");
			try {
				const content = await fs.readFile(configPath, "utf-8");
				if (!isValidConfig(content)) {
					return;
				}
			} catch {
				// No config file — silent exit
				return;
			}

			const adapter = options.adapter;

			// Log to .debug.log
			try {
				const cwd = process.cwd();
				const logDir = path.join(cwd, await getLogDir(cwd));
				const globalConfig = await loadGlobalConfig();
				const projectDebugLogConfig = await getDebugLogConfig(cwd);
				const debugLogConfig = mergeDebugLogConfig(
					projectDebugLogConfig,
					globalConfig.debug_log,
				);
				const debugLogger = new DebugLogger(logDir, debugLogConfig);
				await debugLogger.logStartHook(adapter);
			} catch {
				// Debug logging should never break the hook
			}

			const output =
				adapter === "cursor"
					? formatCursorOutput(START_HOOK_MESSAGE)
					: formatClaudeOutput(START_HOOK_MESSAGE);

			console.log(output);
		});
}
