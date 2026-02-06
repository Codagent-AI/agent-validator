import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type CLIAdapter, runStreamingCommand } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface CodexUsage {❯ /plan-review /Users/pcaplan/.cursor/plans/telemetry-and-adapter-config_718274bd.plan.md
  as response to /Users/pcaplan/paul/agent-gauntlet/docs/token-usage-investigation.md
	inputTokens?: number;
	cachedInputTokens?: number;
	outputTokens?: number;
	toolCalls?: number;
	apiRequests?: number;
}

/** Parse a single JSONL line into a typed event, or undefined on failure. */
function parseJsonlLine(
	line: string,
): { type: string; [key: string]: unknown } | undefined {
	try {
		const obj = JSON.parse(line);
		if (obj && typeof obj.type === "string") return obj;
	} catch {
		/* skip malformed lines */
	}
	return undefined;
}

/** Accumulate a turn.completed event's usage into totals. */
function accumulateTurnUsage(
	event: { type: string; [key: string]: unknown },
	usage: CodexUsage,
): void {
	const u = event.usage as
		| {
				input_tokens?: number;
				cached_input_tokens?: number;
				output_tokens?: number;
		  }
		| undefined;
	if (!u) return;
	usage.apiRequests = (usage.apiRequests || 0) + 1;
	if (u.input_tokens !== undefined) {
		usage.inputTokens = (usage.inputTokens || 0) + u.input_tokens;
	}
	if (u.cached_input_tokens !== undefined) {
		usage.cachedInputTokens =
			(usage.cachedInputTokens || 0) + u.cached_input_tokens;
	}
	if (u.output_tokens !== undefined) {
		usage.outputTokens = (usage.outputTokens || 0) + u.output_tokens;
	}
}

/** Check if an item.completed event represents a tool call (command, file, mcp). */
function isToolCallItem(event: {
	type: string;
	[key: string]: unknown;
}): boolean {
	const item = event.item as { type?: string } | undefined;
	if (!item?.type) return false;
	return (
		item.type === "command_execution" ||
		item.type === "file_change" ||
		item.type === "mcp_tool_call"
	);
}

/** Extract the final agent message text from a completed item. */
function extractAgentMessage(event: {
	type: string;
	[key: string]: unknown;
}): string | undefined {
	const item = event.item as { type?: string; text?: string } | undefined;
	if (item?.type === "agent_message" && typeof item.text === "string") {
		return item.text;
	}
	return undefined;
}

const SUMMARY_FIELDS: Array<[keyof CodexUsage, string]> = [
	["inputTokens", "in"],
	["cachedInputTokens", "cache"],
	["outputTokens", "out"],
	["toolCalls", "tool_calls"],
	["apiRequests", "api_requests"],
];

function formatCodexSummary(usage: CodexUsage): string | null {
	const parts = SUMMARY_FIELDS.filter(
		([key]) => usage[key] !== undefined,
	).map(([key, label]) => `${label}=${usage[key]}`);
	return parts.length > 0 ? `[codex-telemetry] ${parts.join(" ")}` : null;
}

/**
 * Parse JSONL output from `codex exec --json`, extracting the final agent
 * message, token usage, and tool call counts.
 */
function parseCodexJsonl(
	raw: string,
	onLog?: (msg: string) => void,
): { text: string; usage: CodexUsage } {
	const usage: CodexUsage = {};
	let lastAgentMessage = "";

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const event = parseJsonlLine(trimmed);
		if (!event) continue;

		if (event.type === "turn.completed") {
			accumulateTurnUsage(event, usage);
		} else if (event.type === "item.completed") {
			if (isToolCallItem(event)) {
				usage.toolCalls = (usage.toolCalls || 0) + 1;
			}
			const msg = extractAgentMessage(event);
			if (msg !== undefined) {
				lastAgentMessage = msg;
			}
		}
	}

	const summary = formatCodexSummary(usage);
	if (summary) {
		onLog?.(`\n${summary}\n`);
		process.stdout.write(`${summary}\n`);
	}

	return { text: lastAgentMessage, usage };
}

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
		// --json: structured JSONL output for telemetry parsing
		// -: reads prompt from stdin
		const args = [
			"exec",
			"--cd",
			repoRoot,
			"--sandbox",
			"read-only",
			"-c",
			'ask_for_approval="never"',
			"--json",
			"-",
		];

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});

		// If onOutput callback is provided, use spawn for real-time streaming
		if (opts.onOutput) {
			// Buffer stdout for JSONL parsing while also streaming to onOutput
			const raw = await runStreamingCommand({
				command: "codex",
				args,
				tmpFile,
				timeoutMs: opts.timeoutMs,
				onOutput: (chunk: string) => {
					opts.onOutput?.(chunk);
				},
				cleanup,
			});

			// Parse JSONL events from stdout for telemetry and final message
			const { text } = parseCodexJsonl(raw, opts.onOutput);
			return text || raw.trimEnd();
		}

		// Otherwise use exec for buffered output
		try {
			const cmd = `cat "${tmpFile}" | codex exec --cd "${repoRoot}" --sandbox read-only -c 'ask_for_approval="never"' --json -`;
			const { stdout } = await execAsync(cmd, {
				timeout: opts.timeoutMs,
				maxBuffer: MAX_BUFFER_BYTES,
			});
			const { text } = parseCodexJsonl(stdout);
			return text || stdout.trimEnd();
		} finally {
			await cleanup();
		}
	}
}
