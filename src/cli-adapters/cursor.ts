import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type CLIAdapter, runStreamingCommand } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

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

	async execute(opts: {
		prompt: string;
		diff: string;
		model?: string;
		timeoutMs?: number;
		onOutput?: (chunk: string) => void;
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

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});

		// If onOutput callback is provided, use spawn for real-time streaming
		if (opts.onOutput) {
			return runStreamingCommand({
				command: "agent",
				args: [],
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
			const cmd = `cat "${tmpFile}" | agent`;
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
