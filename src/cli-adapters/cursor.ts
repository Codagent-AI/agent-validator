import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getCategoryLogger } from "../output/app-logger.js";
import { type CLIAdapter, runStreamingCommand } from "./shared.js";
import {
	resolveModelFromList,
	SAFE_MODEL_ID_PATTERN,
} from "./model-resolution.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const log = getCategoryLogger("cursor");

/**
 * Parse `agent --list-models` output into an array of model IDs.
 * Each line has the format: "model-id - Display Name"
 */
function parseModelList(output: string): string[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const dashIndex = line.indexOf(" - ");
			return dashIndex >= 0 ? line.substring(0, dashIndex).trim() : line.trim();
		})
		.filter((id) => id.length > 0);
}

export class CursorAdapter implements CLIAdapter {
	name = "cursor";

	async isAvailable(): Promise<boolean> {
		try {
			// Note: Cursor's CLI binary is named "agent", not "cursor"
			await execAsync("which agent");
			return true;
		} catch {
			return false;
		}
	}

	async checkHealth(): Promise<{
		available: boolean;
		status: "healthy" | "missing" | "unhealthy";
		message?: string;
	}> {
		const available = await this.isAvailable();
		if (!available) {
			return {
				available: false,
				status: "missing",
				message: "Command not found",
			};
		}

		return { available: true, status: "healthy", message: "Ready" };
	}

	getProjectCommandDir(): string | null {
		// Cursor does not support custom commands
		return null;
	}

	getUserCommandDir(): string | null {
		// Cursor does not support custom commands
		return null;
	}

	getProjectSkillDir(): string | null {
		return null;
	}

	getUserSkillDir(): string | null {
		return null;
	}

	getCommandExtension(): string {
		return ".md";
	}

	canUseSymlink(): boolean {
		// Not applicable - no command directory support
		return false;
	}

	transformCommand(markdownContent: string): string {
		// Not applicable - no command directory support
		return markdownContent;
	}

	supportsHooks(): boolean {
		return true;
	}

	/**
	 * Resolve a base model name to a specific model ID using `agent --list-models`.
	 * Returns undefined if resolution fails or no matching model is found.
	 *
	 * Uses exec() directly (instead of the module-level execAsync) so that
	 * spyOn(childProcess, "exec") can intercept calls in tests.
	 */
	private async resolveModel(
		baseName: string,
		thinkingBudget?: string,
	): Promise<string | undefined> {
		try {
			const stdout = await new Promise<string>((resolve, reject) => {
				exec("agent --list-models", { timeout: 10000 }, (error, stdout) => {
					if (error) reject(error);
					else resolve(stdout);
				});
			});
			const models = parseModelList(stdout);
			const preferThinking =
				thinkingBudget !== undefined && thinkingBudget !== "off";
			const resolved = resolveModelFromList(models, {
				baseName,
				preferThinking,
			});
			if (resolved === undefined) {
				log.warn(`No matching model found for "${baseName}"`);
				return undefined;
			}
			if (!SAFE_MODEL_ID_PATTERN.test(resolved)) {
				log.warn(`Resolved model "${resolved}" contains unsafe characters`);
				return undefined;
			}
			return resolved;
		} catch (err) {
			log.warn(
				`Failed to resolve model "${baseName}": ${err instanceof Error ? err.message : String(err)}`,
			);
			return undefined;
		}
	}

	async execute(opts: {
		prompt: string;
		diff: string;
		model?: string;
		timeoutMs?: number;
		onOutput?: (chunk: string) => void;
		thinkingBudget?: string;
	}): Promise<string> {
		const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

		const tmpDir = os.tmpdir();
		// Include process.pid for uniqueness across concurrent processes
		const tmpFile = path.join(
			tmpDir,
			`gauntlet-cursor-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		// Cursor agent command reads from stdin
		// Note: As of the current version, the Cursor 'agent' CLI does not expose
		// flags for restricting tools or enforcing read-only mode (unlike claude's --allowedTools
		// or codex's --sandbox read-only). The agent is assumed to be repo-scoped and
		// safe for code review use. If Cursor adds such flags in the future, they should
		// be added here for defense-in-depth.

		// Resolve model if a base name is provided
		let resolvedModel: string | undefined;
		if (opts.model) {
			resolvedModel = await this.resolveModel(opts.model, opts.thinkingBudget);
		}

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});

		// Build args with optional --model flag
		const args = ["--trust"];
		if (resolvedModel) {
			args.push("--model", resolvedModel);
		}

		// If onOutput callback is provided, use spawn for real-time streaming
		if (opts.onOutput) {
			return runStreamingCommand({
				command: "agent",
				args,
				tmpFile,
				timeoutMs: opts.timeoutMs,
				onOutput: opts.onOutput,
				cleanup,
			});
		}

		// Otherwise use exec for buffered output
		// Shell command construction: We use exec() with shell piping
		// because the agent requires stdin input. The tmpFile path is system-controlled
		// (os.tmpdir() + Date.now() + process.pid), not user-supplied, eliminating injection risk.
		// Double quotes handle paths with spaces.
		try {
			const modelFlag = resolvedModel ? ` --model ${resolvedModel}` : "";
			const cmd = `cat "${tmpFile}" | agent --trust${modelFlag}`;
			const { stdout } = await execAsync(cmd, {
				timeout: opts.timeoutMs,
				maxBuffer: MAX_BUFFER_BYTES,
			});
			return stdout;
		} finally {
			// Cleanup errors are intentionally ignored - the tmp file will be cleaned up by OS
			await cleanup();
		}
	}
}
