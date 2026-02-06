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
// Optionally matches [otel] prefix that some exporters add.
const OTEL_METRIC_BLOCK_RE =
	/(?:\[otel\]\s*)?\{\s*\n\s*descriptor:\s*\{[\s\S]*?dataPointType:\s*\d+[\s\S]*?dataPoints:\s*\[[\s\S]*?\]\s*,?\s*\n\}/g;

interface OtelUsage {
	cost?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheCreation?: number;
	toolCalls?: number;
	toolContentBytes?: number;
	apiRequests?: number;
}

const TOKEN_TYPES = ["input", "output", "cacheRead", "cacheCreation"] as const;

function parseCostBlock(block: string): number | undefined {
	const match = block.match(/value:\s*([\d.]+)/);
	return match ? Number.parseFloat(match[1]) : undefined;
}

function parseTokenBlock(block: string): Partial<OtelUsage> {
	const result: Partial<OtelUsage> = {};
	const re = /type:\s*"(\w+)"[\s\S]*?value:\s*(\d+)(?:,|\s*\})/g;
	for (const match of block.matchAll(re)) {
		const type = match[1] as (typeof TOKEN_TYPES)[number];
		if (TOKEN_TYPES.includes(type)) {
			result[type] = Number.parseInt(match[2], 10);
		}
	}
	return result;
}

function parseOtelMetrics(blocks: string[]): OtelUsage {
	const usage: OtelUsage = {};
	for (const block of blocks) {
		const nameMatch = block.match(/name:\s*"([^"]+)"/);
		if (!nameMatch) continue;

		if (nameMatch[1] === "claude_code.cost.usage") {
			usage.cost = parseCostBlock(block);
		} else if (nameMatch[1] === "claude_code.token.usage") {
			Object.assign(usage, parseTokenBlock(block));
		}
	}
	return usage;
}

// Matches OTel console log exporter event records emitted by Claude Code.
// The Node.js SDK console exporter uses util.inspect() format with unquoted keys
// and single-quoted strings. Blocks start with `resource:` and contain a `body:`
// field with the event name (e.g. 'claude_code.tool_result').
const OTEL_LOG_BLOCK_RE =
	/\{\s*\n\s*resource:\s*\{[\s\S]*?body:\s*'claude_code\.\w+'[\s\S]*?\n\}/g;

/** Extract a single-quoted attribute value from a util.inspect() block. */
function extractAttr(block: string, key: string): string | undefined {
	const re = new RegExp(`${key}:\\s*'([^']*)'`);
	return block.match(re)?.[1];
}

/** Extract a numeric attribute value stored as a quoted string. */
function extractNumAttr(block: string, key: string): number | undefined {
	const val = extractAttr(block, key);
	return val !== undefined ? Number(val) : undefined;
}

/** Accumulate a single tool_result event into usage. */
function accumulateToolResult(block: string, usage: OtelUsage): void {
	usage.toolCalls = (usage.toolCalls || 0) + 1;
	const bytes = extractNumAttr(block, "tool_result_size_bytes");
	if (bytes !== undefined) {
		usage.toolContentBytes = (usage.toolContentBytes || 0) + bytes;
	}
}

/** Accumulate a single api_request event into usage. */
function accumulateApiRequest(block: string, usage: OtelUsage): void {
	usage.apiRequests = (usage.apiRequests || 0) + 1;
	const inputTokens = extractNumAttr(block, "input_tokens");
	if (inputTokens !== undefined) {
		usage.input = (usage.input || 0) + inputTokens;
	}
	const outputTokens = extractNumAttr(block, "output_tokens");
	if (outputTokens !== undefined) {
		usage.output = (usage.output || 0) + outputTokens;
	}
	const cacheRead = extractNumAttr(block, "cache_read_tokens");
	if (cacheRead !== undefined) {
		usage.cacheRead = (usage.cacheRead || 0) + cacheRead;
	}
	const cacheCreation = extractNumAttr(block, "cache_creation_tokens");
	if (cacheCreation !== undefined) {
		usage.cacheCreation = (usage.cacheCreation || 0) + cacheCreation;
	}
	const costUsd = extractNumAttr(block, "cost_usd");
	if (costUsd !== undefined) {
		usage.cost = (usage.cost || 0) + costUsd;
	}
}

/** Accumulate tool_result and api_request event data from OTel log blocks. */
function parseOtelLogEvents(raw: string, usage: OtelUsage): void {
	const blocks = raw.match(OTEL_LOG_BLOCK_RE);
	if (!blocks) return;
	for (const block of blocks) {
		const body = extractAttr(block, "body");
		if (body === "claude_code.tool_result") {
			accumulateToolResult(block, usage);
		} else if (body === "claude_code.api_request") {
			accumulateApiRequest(block, usage);
		}
	}
}

function formatOtelSummary(usage: OtelUsage): string | null {
	if (usage.cost === undefined && usage.input === undefined) return null;

	const parts: string[] = [];
	if (usage.cost !== undefined) parts.push(`cost=$${usage.cost.toFixed(4)}`);
	if (usage.input !== undefined) parts.push(`in=${usage.input}`);
	if (usage.output !== undefined) parts.push(`out=${usage.output}`);
	if (usage.cacheRead !== undefined) parts.push(`cacheRead=${usage.cacheRead}`);
	if (usage.cacheCreation !== undefined)
		parts.push(`cacheWrite=${usage.cacheCreation}`);
	if (usage.toolCalls !== undefined) parts.push(`tool_calls=${usage.toolCalls}`);
	if (usage.toolContentBytes !== undefined)
		parts.push(`tool_content_bytes=${usage.toolContentBytes}`);
	if (usage.apiRequests !== undefined)
		parts.push(`api_requests=${usage.apiRequests}`);

	return `[otel] ${parts.join(" ")}`;
}

function extractOtelMetrics(
	raw: string,
	onLog?: (msg: string) => void,
): string {
	const metricBlocks = raw.match(OTEL_METRIC_BLOCK_RE);
	const usage = metricBlocks ? parseOtelMetrics(metricBlocks) : {};

	// Also parse log events for tool call and API request counts
	parseOtelLogEvents(raw, usage);

	const summary = formatOtelSummary(usage);
	if (summary) {
		// Output summary to adapter log
		onLog?.(`\n${summary}\n`);
		// Output summary to console log (captured by startConsoleLog)
		process.stdout.write(`${summary}\n`);
	}

	return raw
		.replace(OTEL_METRIC_BLOCK_RE, "")
		.replace(OTEL_LOG_BLOCK_RE, "")
		.trimEnd();
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
		return path.join(os.homedir(), ".claude", "commands");
	}

	getCommandExtension(): string {
		return ".md";
	}

	canUseSymlink(): boolean {
		return true;
	}

	transformCommand(markdownContent: string): string {
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
		const tmpFile = path.join(
			tmpDir,
			`gauntlet-claude-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		const args = [
			"-p",
			"--allowedTools",
			"Read,Glob,Grep",
			"--max-turns",
			"10",
		];

		const otelEnv: Record<string, string> = {};
		if (!process.env.CLAUDE_CODE_ENABLE_TELEMETRY) {
			otelEnv.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
		}
		if (!process.env.OTEL_METRICS_EXPORTER) {
			otelEnv.OTEL_METRICS_EXPORTER = "console";
		}
		if (!process.env.OTEL_LOGS_EXPORTER) {
			otelEnv.OTEL_LOGS_EXPORTER = "console";
		}

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});

		if (opts.onOutput) {
			// Buffer all output to filter OTel blocks before calling onOutput
			// OTel metrics appear at process exit, so we process the full output
			const outputBuffer: string[] = [];
			const raw = await runStreamingCommand({
				command: "claude",
				args,
				tmpFile,
				timeoutMs: opts.timeoutMs,
				onOutput: (chunk: string) => {
					outputBuffer.push(chunk);
				},
				cleanup,
				env: {
					...process.env,
					[GAUNTLET_STOP_HOOK_ACTIVE_ENV]: "1",
					...otelEnv,
				},
			});
			// Filter OTel blocks from buffer (stdout+stderr) and output cleaned content
			const fullOutput = outputBuffer.join("");
			const cleanedOutput = extractOtelMetrics(fullOutput, opts.onOutput);
			opts.onOutput(cleanedOutput);
			// Return cleaned stdout (raw only contains stdout)
			return raw
				.replace(OTEL_METRIC_BLOCK_RE, "")
				.replace(OTEL_LOG_BLOCK_RE, "")
				.trimEnd();
		}

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
			return extractOtelMetrics(stdout);
		} finally {
			await cleanup();
		}
	}
}
