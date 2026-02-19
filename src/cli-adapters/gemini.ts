import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getDebugLogger } from "../utils/debug-log.js";
import { type CLIAdapter, runStreamingCommand } from "./index.js";
import { GEMINI_THINKING_BUDGET } from "./thinking-budget.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface GeminiTelemetryUsage {
	inputTokens?: number;
	outputTokens?: number;
	thoughtTokens?: number;
	cacheTokens?: number;
	toolTokens?: number;
	toolCalls?: number;
	toolContentChars?: number;
	apiRequests?: number;
}

type TokenType = "input" | "output" | "thought" | "cache" | "tool";
const TOKEN_TYPE_MAP: Record<TokenType, keyof GeminiTelemetryUsage> = {
	input: "inputTokens",
	output: "outputTokens",
	thought: "thoughtTokens",
	cache: "cacheTokens",
	tool: "toolTokens",
};

// Gemini CLI telemetry file contains pretty-printed JSON objects (not OTLP).
// The metric object has { resource, scopeMetrics: [{ scope, metrics }] }.
// Each metric has { descriptor: { name, type }, dataPoints: [{ value, attributes }] }.

interface SdkDataPoint {
	value: number | { sum?: number };
	attributes?: Record<string, string | number | boolean>;
}

interface SdkMetric {
	descriptor?: { name?: string };
	dataPoints?: SdkDataPoint[];
}

interface SdkScopeMetrics {
	metrics?: SdkMetric[];
}

function extractTokenType(dp: SdkDataPoint): TokenType | null {
	const type =
		dp.attributes?.type ?? dp.attributes?.["gen_ai.token.type"] ?? null;
	return typeof type === "string" && type in TOKEN_TYPE_MAP
		? (type as TokenType)
		: null;
}

function extractValue(dp: SdkDataPoint): number {
	if (typeof dp.value === "number") return dp.value;
	return dp.value?.sum ?? 0;
}

function processDataPoints(
	dataPoints: SdkDataPoint[],
	usage: GeminiTelemetryUsage,
): void {
	for (const dp of dataPoints) {
		const tokenType = extractTokenType(dp);
		if (!tokenType) continue;
		const key = TOKEN_TYPE_MAP[tokenType];
		usage[key] = (usage[key] || 0) + extractValue(dp);
	}
}

const TOKEN_METRIC_NAMES = new Set([
	"gemini_cli.token.usage",
	"gen_ai.client.token.usage",
]);

/**
 * Find [start, end) index pairs for each top-level `{…}` in a string
 * whose JSON string literals have already been blanked out.
 */
function handleOpen(i: number, depth: number, start: number): [number, number] {
	return [depth + 1, depth === 0 ? i : start];
}

function handleClose(
	i: number,
	depth: number,
	start: number,
	ranges: Array<[number, number]>,
): [number, number] {
	const next = depth - 1;
	if (next === 0 && start >= 0) {
		ranges.push([start, i + 1]);
		return [next, -1];
	}
	return [next, start];
}

function findObjectBoundaries(stripped: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let depth = 0;
	let start = -1;
	for (let i = 0; i < stripped.length; i++) {
		const ch = stripped[i];
		if (ch === "{") [depth, start] = handleOpen(i, depth, start);
		else if (ch === "}") [depth, start] = handleClose(i, depth, start, ranges);
	}
	return ranges;
}

/**
 * Parse top-level JSON objects from telemetry content.
 * Blanks string literals (preserving length) before brace-counting
 * so braces inside strings are ignored.
 */
function parseJsonObjects(content: string): unknown[] {
	const stripped = content.replace(/"(?:[^"\\]|\\.)*"/g, (m) =>
		" ".repeat(m.length),
	);
	const objects: unknown[] = [];
	for (const [s, e] of findObjectBoundaries(stripped)) {
		try {
			objects.push(JSON.parse(content.slice(s, e)));
		} catch {
			// Skip malformed objects
		}
	}
	return objects;
}

/** Sum all data point values for a counter metric. */
function sumDataPoints(dataPoints: SdkDataPoint[]): number {
	let total = 0;
	for (const dp of dataPoints) {
		total += extractValue(dp);
	}
	return total;
}

/** Route a single metric to the appropriate usage field. */
function processMetric(metric: SdkMetric, usage: GeminiTelemetryUsage): void {
	const name = metric.descriptor?.name;
	if (!name) return;
	const dataPoints = metric.dataPoints ?? [];

	if (TOKEN_METRIC_NAMES.has(name)) {
		processDataPoints(dataPoints, usage);
		return;
	}
	if (name === "gemini_cli.tool.call.count") {
		usage.toolCalls = (usage.toolCalls || 0) + sumDataPoints(dataPoints);
		return;
	}
	if (name === "gemini_cli.api.request.count") {
		usage.apiRequests = (usage.apiRequests || 0) + sumDataPoints(dataPoints);
	}
}

function processMetricObject(data: unknown, usage: GeminiTelemetryUsage): void {
	const obj = data as { scopeMetrics?: SdkScopeMetrics[] };
	if (!obj?.scopeMetrics) return;
	for (const sm of obj.scopeMetrics) {
		for (const metric of sm.metrics ?? []) {
			processMetric(metric, usage);
		}
	}
}

/**
 * Extract tool call details from OTel log records.
 * The Gemini CLI emits `gemini_cli.tool_call` log events with
 * content_length attributes that reveal how much data tools read.
 */
interface SdkLogRecord {
	body?: { stringValue?: string };
	attributes?: Array<{
		key: string;
		value: { intValue?: string; stringValue?: string };
	}>;
}

interface SdkScopeLogs {
	logRecords?: SdkLogRecord[];
}

/** Extract content_length from a tool_call log record, or 0 if absent. */
function extractToolContentLength(record: SdkLogRecord): number {
	const attr = record.attributes?.find((a) => a.key === "content_length");
	if (!attr?.value?.intValue) return 0;
	const len = parseInt(attr.value.intValue, 10);
	return Number.isNaN(len) ? 0 : len;
}

/** Sum content_length across all tool_call log records in a scope. */
function sumToolContentChars(records: SdkLogRecord[]): number {
	let total = 0;
	for (const record of records) {
		if (record.body?.stringValue !== "gemini_cli.tool_call") continue;
		total += extractToolContentLength(record);
	}
	return total;
}

function processLogObject(data: unknown, usage: GeminiTelemetryUsage): void {
	const obj = data as { scopeLogs?: SdkScopeLogs[] };
	if (!obj?.scopeLogs) return;
	for (const sl of obj.scopeLogs) {
		const chars = sumToolContentChars(sl.logRecords ?? []);
		if (chars > 0) {
			usage.toolContentChars = (usage.toolContentChars || 0) + chars;
		}
	}
}

async function parseGeminiTelemetry(
	filePath: string,
): Promise<GeminiTelemetryUsage> {
	const usage: GeminiTelemetryUsage = {};
	let content: string;

	try {
		content = await fs.readFile(filePath, "utf-8");
	} catch {
		return usage;
	}

	for (const obj of parseJsonObjects(content)) {
		processMetricObject(obj, usage);
		processLogObject(obj, usage);
	}

	return usage;
}

const SUMMARY_FIELDS: Array<[keyof GeminiTelemetryUsage, string]> = [
	["inputTokens", "in"],
	["outputTokens", "out"],
	["thoughtTokens", "thought"],
	["cacheTokens", "cache"],
	["toolTokens", "tool"],
	["toolCalls", "tool_calls"],
	["toolContentChars", "tool_content_chars"],
	["apiRequests", "api_requests"],
];

function formatGeminiSummary(usage: GeminiTelemetryUsage): string | null {
	const parts = SUMMARY_FIELDS.filter(([key]) => usage[key] !== undefined).map(
		([key, label]) => `${label}=${usage[key]}`,
	);
	return parts.length > 0 ? `[telemetry] ${parts.join(" ")}` : null;
}

async function logTelemetryToStderr(telemetryFile: string): Promise<void> {
	if (process.env.GEMINI_TELEMETRY_OUTFILE) return;
	const usage = await parseGeminiTelemetry(telemetryFile);
	const summary = formatGeminiSummary(usage);
	if (summary) {
		process.stderr.write(`${summary}\n`);
		getDebugLogger()?.logTelemetry({ adapter: "gemini", summary });
	}
}

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
		return path.join(os.homedir(), ".gemini", "commands");
	}

	getProjectSkillDir(): string | null {
		return null;
	}

	getUserSkillDir(): string | null {
		return null;
	}

	getCommandExtension(): string {
		return ".toml";
	}

	canUseSymlink(): boolean {
		return false;
	}

	supportsHooks(): boolean {
		return false;
	}

	transformCommand(markdownContent: string): string {
		const fmMatch = markdownContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		let description = "Run the gauntlet verification suite";
		const body = fmMatch ? (fmMatch[2] ?? "") : markdownContent;

		if (fmMatch) {
			for (const line of (fmMatch[1] ?? "").split("\n")) {
				const kv = line.match(/^description:\s*(.*)$/);
				if (kv?.[1]) description = kv[1].trim();
			}
		}

		return `description = ${JSON.stringify(description)}
prompt = """
${body.trim()}
"""
`;
	}

	private async logTelemetry(
		telemetryFile: string,
		onOutput: (chunk: string) => void,
	): Promise<void> {
		if (process.env.GEMINI_TELEMETRY_OUTFILE) return;
		const usage = await parseGeminiTelemetry(telemetryFile);
		const summary = formatGeminiSummary(usage);
		if (summary) {
			onOutput(`\n${summary}\n`);
			process.stderr.write(`${summary}\n`);
			getDebugLogger()?.logTelemetry({ adapter: "gemini", summary });
		}
	}

	/**
	 * Serialize access to .gemini/settings.json across concurrent Gemini instances.
	 * When multiple Gemini adapters run in parallel (num_reviews > 1 with
	 * cli_preference: ["gemini"]), each waits for the previous to finish
	 * before writing its settings.
	 */
	private static settingsLock: Promise<void> = Promise.resolve();

	private async applyThinkingSettings(
		budget: number,
	): Promise<() => Promise<void>> {
		let releaseLock = () => {};
		const prev = GeminiAdapter.settingsLock;
		GeminiAdapter.settingsLock = new Promise((resolve) => {
			releaseLock = resolve;
		});
		await prev;

		const settingsPath = path.join(process.cwd(), ".gemini", "settings.json");
		let backup: string | null = null;
		let existed = false;

		try {
			try {
				backup = await fs.readFile(settingsPath, "utf-8");
				existed = true;
			} catch {
				// No existing file
			}

			const existing = backup ? JSON.parse(backup) : {};
			const merged = {
				...existing,
				thinkingConfig: { ...existing.thinkingConfig, thinkingBudget: budget },
			};

			await fs.mkdir(path.dirname(settingsPath), { recursive: true });
			await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2));
		} catch (err) {
			releaseLock();
			throw err;
		}

		return async () => {
			try {
				if (existed && backup !== null) {
					await fs.writeFile(settingsPath, backup);
				} else {
					await fs.unlink(settingsPath).catch(() => {});
				}
			} finally {
				releaseLock();
			}
		};
	}

	private buildTelemetryEnv(telemetryFile: string): Record<string, string> {
		const env: Record<string, string> = {};
		if (!process.env.GEMINI_TELEMETRY_ENABLED) {
			env.GEMINI_TELEMETRY_ENABLED = "true";
		}
		if (!process.env.GEMINI_TELEMETRY_TARGET) {
			env.GEMINI_TELEMETRY_TARGET = "local";
		}
		if (!process.env.GEMINI_TELEMETRY_OUTFILE) {
			env.GEMINI_TELEMETRY_OUTFILE = telemetryFile;
		}
		return env;
	}

	private buildArgs(allowToolUse?: boolean): string[] {
		const args = ["--sandbox"];
		if (allowToolUse !== false) {
			args.push(
				"--allowed-tools",
				"read_file,list_directory,glob,search_file_content",
			);
		}
		args.push("--output-format", "text");
		return args;
	}

	private async maybeApplyThinking(
		level?: string,
	): Promise<(() => Promise<void>) | undefined> {
		if (!(level && (level in GEMINI_THINKING_BUDGET))) return undefined;
		return this.applyThinkingSettings(GEMINI_THINKING_BUDGET[level] as number);
	}

	async execute(opts: {
		prompt: string;
		diff: string;
		model?: string;
		timeoutMs?: number;
		onOutput?: (chunk: string) => void;
		allowToolUse?: boolean;
		thinkingBudget?: string;
	}): Promise<string> {
		const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

		const tmpDir = os.tmpdir();
		const tmpFile = path.join(
			tmpDir,
			`gauntlet-gemini-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		// Use cwd for telemetry file — Gemini's --sandbox restricts writes
		// to the project directory, so os.tmpdir() would fail with EPERM.
		const telemetryFile = path.join(
			process.cwd(),
			`.gauntlet-gemini-telemetry-${process.pid}-${Date.now()}.log`,
		);

		const telemetryEnv = this.buildTelemetryEnv(telemetryFile);
		const args = this.buildArgs(opts.allowToolUse);
		const cleanupThinking = await this.maybeApplyThinking(opts.thinkingBudget);

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});
		const cleanupTelemetry = () => fs.unlink(telemetryFile).catch(() => {});

		try {
			if (opts.onOutput) {
				try {
					const result = await runStreamingCommand({
						command: "gemini",
						args,
						tmpFile,
						timeoutMs: opts.timeoutMs,
						onOutput: opts.onOutput,
						cleanup,
						env: { ...process.env, ...telemetryEnv },
					});
					await this.logTelemetry(telemetryFile, opts.onOutput);
					return result;
				} finally {
					await cleanupTelemetry();
				}
			}

			try {
				const cmd = `gemini ${args.join(" ")} < "${tmpFile}"`;
				const { stdout } = await execAsync(cmd, {
					timeout: opts.timeoutMs,
					maxBuffer: MAX_BUFFER_BYTES,
					env: { ...process.env, ...telemetryEnv },
				});
				await logTelemetryToStderr(telemetryFile);
				return stdout;
			} finally {
				await cleanup();
				await cleanupTelemetry();
			}
		} finally {
			await cleanupThinking?.();
		}
	}
}
