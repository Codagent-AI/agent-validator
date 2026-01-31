export interface CLIAdapterHealth {
	available: boolean;
	status: "healthy" | "missing" | "unhealthy";
	message?: string;
}

import type { ChildProcess } from "node:child_process";

/**
 * Collects stderr from a child process and returns a getter for the accumulated output.
 * Also forwards each chunk to the optional onOutput callback.
 */
export function collectStderr(
	child: ChildProcess,
	onOutput?: (text: string) => void,
): () => string {
	const chunks: string[] = [];
	child.stderr?.on("data", (data: Buffer) => {
		const text = data.toString();
		chunks.push(text);
		onOutput?.(text);
	});
	return () => chunks.join("");
}

/**
 * Builds an Error for a non-zero process exit, including stdout and stderr if available.
 * Both stdout and stderr are included to ensure usage limit messages are captured
 * regardless of which stream the CLI writes them to.
 */
export function processExitError(
	code: number | null,
	getStderr: () => string,
	getStdout?: () => string,
): Error {
	const stderr = getStderr();
	const stdout = getStdout?.() ?? "";
	const output = [stdout, stderr].filter(Boolean).join("\n");
	return new Error(
		`Process exited with code ${code}${output ? `\n${output}` : ""}`,
	);
}

export function isUsageLimit(output: string): boolean {
	const lower = output.toLowerCase();
	return (
		lower.includes("usage limit") ||
		lower.includes("quota exceeded") ||
		lower.includes("quota will reset") ||
		lower.includes("credit balance is too low") ||
		lower.includes("out of extra usage") ||
		lower.includes("out of usage")
	);
}

export interface CLIAdapter {
	name: string;
	isAvailable(): Promise<boolean>;
	checkHealth(): Promise<CLIAdapterHealth>;
	execute(opts: {
		prompt: string;
		diff: string;
		model?: string;
		timeoutMs?: number;
		/** Optional callback for real-time output streaming */
		onOutput?: (chunk: string) => void;
	}): Promise<string>;
	/**
	 * Returns the project-scoped command directory path (relative to project root).
	 * Returns null if the CLI only supports user-level commands.
	 */
	getProjectCommandDir(): string | null;
	/**
	 * Returns the user-level command directory path (absolute path).
	 * Returns null if the CLI doesn't support user-level commands.
	 */
	getUserCommandDir(): string | null;
	/**
	 * Returns the command file extension used by this CLI.
	 */
	getCommandExtension(): string;
	/**
	 * Returns true if this adapter can use symlinks (same format as source Markdown).
	 */
	canUseSymlink(): boolean;
	/**
	 * Transforms gauntlet command content to this CLI's format.
	 * The source content is always Markdown with YAML frontmatter.
	 */
	transformCommand(markdownContent: string): string;
}

import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { GeminiAdapter } from "./gemini.js";
import { GitHubCopilotAdapter } from "./github-copilot.js";

export {
	GeminiAdapter,
	CodexAdapter,
	ClaudeAdapter,
	GitHubCopilotAdapter,
	CursorAdapter,
};

// Adapter registry: keys should use lowercase with hyphens for multi-word names
const adapters: Record<string, CLIAdapter> = {
	gemini: new GeminiAdapter(),
	codex: new CodexAdapter(),
	claude: new ClaudeAdapter(),
	"github-copilot": new GitHubCopilotAdapter(),
	cursor: new CursorAdapter(),
};

export function getAdapter(name: string): CLIAdapter | undefined {
	return adapters[name];
}

export function getAllAdapters(): CLIAdapter[] {
	return Object.values(adapters);
}

/**
 * Returns all adapters that support project-scoped commands.
 */
export function getProjectCommandAdapters(): CLIAdapter[] {
	return Object.values(adapters).filter(
		(a) => a.getProjectCommandDir() !== null,
	);
}

/**
 * Returns all adapters that support user-level commands.
 */
export function getUserCommandAdapters(): CLIAdapter[] {
	return Object.values(adapters).filter((a) => a.getUserCommandDir() !== null);
}

/**
 * Returns all valid CLI tool names (adapter registry keys).
 */
export function getValidCLITools(): string[] {
	return Object.keys(adapters);
}
