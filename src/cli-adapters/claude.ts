import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GAUNTLET_STOP_HOOK_ACTIVE_ENV } from "../commands/stop-hook.js";
import { type CLIAdapter, runStreamingCommand } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

// Matches OTel console exporter metric blocks dumped to stdout at process exit.
// Requires `descriptor`, `dataPointType`, and `dataPoints` fields which are
// unique to OTel SDK output and won't appear in normal code review content.
const OTEL_METRIC_BLOCK_RE =
	/\{\s*\n\s*descriptor:\s*\{[\s\S]*?dataPointType:\s*\d+[\s\S]*?dataPoints:\s*\[[\s\S]*?\]\s*,?\s*\n\}/g;

interface OtelUsage {
	cost?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheCreation?: number;
}

/**
 * Parse OTel metric blocks and extract cost + token usage values.
 */
function parseOtelMetrics(blocks: string[]): OtelUsage {
	const usage: OtelUsage = {};

	for (const block of blocks) {
		// Extract metric name
		const nameMatch = block.match(/name:\s*"([^"]+)"/);
		if (!nameMatch) continue;
		const name = nameMatch[1];

		if (name === "claude_code.cost.usage") {
			// Single value for cost
			const valueMatch = block.match(/value:\s*([\d.]+)/);
			if (valueMatch) {
				usage.cost = Number.parseFloat(valueMatch[1]);
			}
		} else if (name === "claude_code.token.usage") {
			// Multiple datapoints with type attributes
			const dataPointRe =
				/type:\s*"(\w+)"[\s\S]*?value:\s*(\d+)(?:,|\s*\})/g;
			let match: RegExpExecArray | null;
			while ((match = dataPointRe.exec(block)) !== null) {
				const type = match[1] as keyof OtelUsage;
				const value = Number.parseInt(match[2], 10);
				if (type in usage || ["input", "output", "cacheRead", "cacheCreation"].includes(type)) {
					usage[type] = value;
				}
			}
		}
	}

	return usage;
}

/**
 * Format OTel usage as a compact one-liner for logging.
 */
function formatOtelSummary(usage: OtelUsage): string | null {
	if (usage.cost === undefined && usage.input === undefined) {
		return null;
	}

	const parts: string[] = [];
	if (usage.cost !== undefined) {
		parts.push(`cost=$${usage.cost.toFixed(4)}`);
	}
	if (usage.input !== undefined) parts.push(`in=${usage.input}`);
	if (usage.output !== undefined) parts.push(`out=${usage.output}`);
	if (usage.cacheRead !== undefined) parts.push(`cacheRead=${usage.cacheRead}`);
	if (usage.cacheCreation !== undefined) parts.push(`cacheWrite=${usage.cacheCreation}`);

	return `[otel] ${parts.join(" ")}`;
}

/**
 * Strip OTel console-exporter metric blocks from raw stdout and optionally
 * log a summary to the provided callback (adapter log only, not terminal).
 */
function extractOtelMetrics(
	raw: string,
	onLog?: (msg: string) => void,
): string {
	const blocks = raw.match(OTEL_METRIC_BLOCK_RE);
	if (!blocks) return raw;

	if (onLog) {
		const usage = parseOtelMetrics(blocks);
		const summary = formatOtelSummary(usage);
		if (summary) {
			onLog(`\n${summary}\n`);
		}
	}

	return raw.replace(OTEL_METRIC_BLOCK_RE, "").trimEnd();
}

export class ClaudeAdapter implements CLIAdapter {
	name = "claude";

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync("which claude");
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
		return ".claude/commands";
	}

	getUserCommandDir(): string | null {
		// Claude supports user-level commands at ~/.claude/commands
		return path.join(os.homedir(), ".claude", "commands");
	}

	getCommandExtension(): string {
		return ".md";
	}

	canUseSymlink(): boolean {
		// Claude uses the same Markdown format as our canonical file
		return true;
	}

	transformCommand(markdownContent: string): string {
		// Claude uses the same Markdown format, no transformation needed
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
			`gauntlet-claude-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		// Recommended invocation per spec:
		// -p: non-interactive print mode
		// --allowedTools: explicitly restricts to read-only tools
		// --max-turns: caps agentic turns
		const args = [
			"-p",
			"--allowedTools",
			"Read,Glob,Grep",
			"--max-turns",
			"10",
		];

		// Enable OTel metrics unless user has explicitly configured these env vars
		const otelEnv: Record<string, string> = {};
		if (!process.env.CLAUDE_CODE_ENABLE_TELEMETRY) {
			otelEnv.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
		}
		if (!process.env.OTEL_METRICS_EXPORTER) {
			otelEnv.OTEL_METRICS_EXPORTER = "console";
		}

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});

		// If onOutput callback is provided, use spawn for real-time streaming
		if (opts.onOutput) {
			const raw = await runStreamingCommand({
				command: "claude",
				args,
				tmpFile,
				timeoutMs: opts.timeoutMs,
				onOutput: opts.onOutput,
				cleanup,
				env: {
					...process.env,
					[GAUNTLET_STOP_HOOK_ACTIVE_ENV]: "1",
					...otelEnv,
				},
			});
			return extractOtelMetrics(raw, opts.onOutput);
		}

		// Otherwise use exec for buffered output
		try {
			const cmd = `cat "${tmpFile}" | claude -p --allowedTools "Read,Glob,Grep" --max-turns 10`;
			const { stdout } = await execAsync(cmd, {
				timeout: opts.timeoutMs,
				maxBuffer: MAX_BUFFER_BYTES,
				env: {
					...process.env,
					[GAUNTLET_STOP_HOOK_ACTIVE_ENV]: "1",
					...otelEnv,
				},
			});
			// No onOutput in buffered mode, so no log destination for summary
			return extractOtelMetrics(stdout);
		} finally {
			await cleanup();
		}
	}
}
