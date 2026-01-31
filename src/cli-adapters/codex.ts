import { exec, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type CLIAdapter, collectStderr, processExitError } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class CodexAdapter implements CLIAdapter {
	name = "codex";

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync("which codex");
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

		return { available: true, status: "healthy", message: "Installed" };
	}

	getProjectCommandDir(): string | null {
		// Codex only supports user-level prompts at ~/.codex/prompts/
		// No project-scoped commands available
		return null;
	}

	getUserCommandDir(): string | null {
		// Codex uses user-level prompts at ~/.codex/prompts/
		return path.join(os.homedir(), ".codex", "prompts");
	}

	getCommandExtension(): string {
		return ".md";
	}

	canUseSymlink(): boolean {
		// Codex uses the same Markdown format as our canonical file
		return true;
	}

	transformCommand(markdownContent: string): string {
		// Codex uses the same Markdown format as Claude, no transformation needed
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
		const tmpFile = path.join(tmpDir, `gauntlet-codex-${Date.now()}.txt`);
		await fs.writeFile(tmpFile, fullContent);

		// Get absolute path to repo root (CWD)
		const repoRoot = process.cwd();

		// Recommended invocation per spec:
		// --cd: sets working directory to repo root
		// --sandbox read-only: prevents file modifications
		// -c ask_for_approval="never": prevents blocking on prompts
		// -: reads prompt from stdin
		const args = [
			"exec",
			"--cd",
			repoRoot,
			"--sandbox",
			"read-only",
			"-c",
			'ask_for_approval="never"',
			"-",
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
						const child = spawn("codex", args, {
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
		try {
			const cmd = `cat "${tmpFile}" | codex exec --cd "${repoRoot}" --sandbox read-only -c 'ask_for_approval="never"' -`;
			const { stdout } = await execAsync(cmd, {
				timeout: opts.timeoutMs,
				maxBuffer: MAX_BUFFER_BYTES,
			});
			return stdout;
		} finally {
			await cleanup();
		}
	}
}
