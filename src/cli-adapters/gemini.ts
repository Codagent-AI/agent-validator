import { exec, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CLIAdapter } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class GeminiAdapter implements CLIAdapter {
	name = "gemini";

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync("which gemini");
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
		return ".gemini/commands";
	}

	getUserCommandDir(): string | null {
		// Gemini supports user-level commands at ~/.gemini/commands
		return path.join(os.homedir(), ".gemini", "commands");
	}

	getCommandExtension(): string {
		return ".toml";
	}

	canUseSymlink(): boolean {
		// Gemini uses TOML format, needs transformation
		return false;
	}

	transformCommand(markdownContent: string): string {
		// Transform Markdown with YAML frontmatter to Gemini's TOML format
		const { frontmatter, body } =
			this.parseMarkdownWithFrontmatter(markdownContent);

		const description =
			frontmatter.description || "Run the gauntlet verification suite";
		// Escape the body for TOML multi-line string
		const escapedBody = body.trim();

		return `description = ${JSON.stringify(description)}
prompt = """
${escapedBody}
"""
`;
	}

	private parseMarkdownWithFrontmatter(content: string): {
		frontmatter: Record<string, string>;
		body: string;
	} {
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!frontmatterMatch) {
			return { frontmatter: {}, body: content };
		}

		const frontmatterStr = frontmatterMatch[1] ?? "";
		const body = frontmatterMatch[2] ?? "";

		// Simple YAML parsing for key: value pairs
		const frontmatter: Record<string, string> = {};
		for (const line of frontmatterStr.split("\n")) {
			const kvMatch = line.match(/^([^:]+):\s*(.*)$/);
			if (kvMatch?.[1] && kvMatch[2] !== undefined) {
				frontmatter[kvMatch[1].trim()] = kvMatch[2].trim();
			}
		}

		return { frontmatter, body };
	}

	async execute(opts: {
		prompt: string;
		diff: string;
		model?: string;
		timeoutMs?: number;
		onOutput?: (chunk: string) => void;
	}): Promise<string> {
		// Construct the full prompt content
		const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

		// Write to a temporary file to avoid shell escaping issues
		const tmpDir = os.tmpdir();
		const tmpFile = path.join(
			tmpDir,
			`gauntlet-gemini-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		// Use gemini CLI with file input
		// --sandbox: enables the execution sandbox
		// --allowed-tools: whitelists read-only tools for non-interactive execution
		// --output-format text: ensures plain text output
		const args = [
			"--sandbox",
			"--allowed-tools",
			"read_file,list_directory,glob,search_file_content",
			"--output-format",
			"text",
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
						const child = spawn("gemini", args, {
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

						child.stderr.on("data", (data: Buffer) => {
							// Only log stderr, don't include in return value
							opts.onOutput?.(data.toString());
						});

						child.on("close", (code) => {
							if (timeoutId) clearTimeout(timeoutId);
							handle.close().catch(() => {});
							cleanup().then(() => {
								if (code === 0 || code === null) {
									resolve(chunks.join(""));
								} else {
									reject(new Error(`Process exited with code ${code}`));
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
			const cmd = `gemini --sandbox --allowed-tools read_file,list_directory,glob,search_file_content --output-format text < "${tmpFile}"`;
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
