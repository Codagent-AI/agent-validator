import { exec, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type CLIAdapter, collectStderr, processExitError } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class GitHubCopilotAdapter implements CLIAdapter {
	name = "github-copilot";

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync("which copilot");
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
		// GitHub Copilot CLI does not support custom commands (feature request #618)
		return null;
	}

	getUserCommandDir(): string | null {
		// GitHub Copilot CLI does not support custom commands (feature request #618)
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
			`gauntlet-copilot-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		// Copilot reads from stdin when no -p flag is provided
		// Tool whitelist: cat/grep/ls/find/head/tail are required for the AI to read
		// and analyze code files during review. While these tools can access files,
		// they are read-only and necessary for code review functionality.
		// The copilot CLI is scoped to the repo directory by default.
		// git is excluded to prevent access to commit history (review should only see diff).
		const args = [
			"--allow-tool",
			"shell(cat)",
			"--allow-tool",
			"shell(grep)",
			"--allow-tool",
			"shell(ls)",
			"--allow-tool",
			"shell(find)",
			"--allow-tool",
			"shell(head)",
			"--allow-tool",
			"shell(tail)",
		];

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});

		// If onOutput callback is provided, use spawn for real-time streaming
		if (opts.onOutput) {
			return new Promise((resolve, reject) => {
				const chunks: string[] = [];
				const inputStream = fs.open(tmpFile, "r").then((handle) => {
					const stream = handle.createReadStream();
					return { stream, handle };
				});

				inputStream
					.then(({ stream, handle }) => {
						const child = spawn("copilot", args, {
							stdio: ["pipe", "pipe", "pipe"],
						});

						stream.pipe(child.stdin);

						let timeoutId: ReturnType<typeof setTimeout> | undefined;
						if (opts.timeoutMs) {
							timeoutId = setTimeout(() => {
								child.kill("SIGTERM");
								reject(new Error("Command timed out"));
							}, opts.timeoutMs);
						}

						child.stdout.on("data", (data: Buffer) => {
							const chunk = data.toString();
							chunks.push(chunk);
							opts.onOutput?.(chunk);
						});

						const getStderr = collectStderr(child, opts.onOutput);

						child.on("close", (code) => {
							if (timeoutId) clearTimeout(timeoutId);
							handle.close().catch(() => {});
							cleanup().then(() => {
								if (code === 0 || code === null) {
									resolve(chunks.join(""));
								} else {
									reject(
										processExitError(code, getStderr, () => chunks.join("")),
									);
								}
							});
						});

						child.on("error", (err) => {
							if (timeoutId) clearTimeout(timeoutId);
							handle.close().catch(() => {});
							cleanup().then(() => reject(err));
						});
					})
					.catch((err) => {
						cleanup().then(() => reject(err));
					});
			});
		}

		// Otherwise use exec for buffered output
		// Shell command construction: We use exec() with shell piping instead of execFile()
		// because copilot requires stdin input. The tmpFile path is system-controlled
		// (os.tmpdir() + Date.now() + process.pid), not user-supplied, eliminating injection risk.
		// Double quotes handle paths with spaces. This pattern matches claude.ts:131.
		try {
			const cmd = `cat "${tmpFile}" | copilot --allow-tool "shell(cat)" --allow-tool "shell(grep)" --allow-tool "shell(ls)" --allow-tool "shell(find)" --allow-tool "shell(head)" --allow-tool "shell(tail)"`;
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
