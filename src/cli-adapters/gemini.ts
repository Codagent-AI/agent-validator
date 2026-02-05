import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type CLIAdapter, runStreamingCommand } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface GeminiTelemetryUsage {
	inputTokens?: number;
	outputTokens?: number;
	thoughtTokens?: number;
	cacheTokens?: number;
	toolTokens?: number;
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
function findObjectBoundaries(stripped: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let depth = 0;
	let start = -1;
	for (let i = 0; i < stripped.length; i++) {
		const ch = stripped[i];
		if (ch !== "{" && ch !== "}") continue;
		if (ch === "{") {
			if (depth === 0) start = i;
			depth++;
			continue;
		}
		depth--;
		if (depth !== 0) continue;
		if (start >= 0) {
			ranges.push([start, i + 1]);
			start = -1;
		}
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

function processMetricObject(data: unknown, usage: GeminiTelemetryUsage): void {
	const obj = data as { scopeMetrics?: SdkScopeMetrics[] };
	if (!obj?.scopeMetrics) return;
	for (const sm of obj.scopeMetrics) {
		for (const metric of sm.metrics ?? []) {
			const name = metric.descriptor?.name;
			if (!name || !TOKEN_METRIC_NAMES.has(name)) continue;
			processDataPoints(metric.dataPoints ?? [], usage);
		}
	}
}

const SUMMARY_FIELDS: Array<[keyof GeminiTelemetryUsage, string]> = [
	["inputTokens", "in"],
	["outputTokens", "out"],
	["thoughtTokens", "thought"],
	["cacheTokens", "cache"],
	["toolTokens", "tool"],
];

function formatGeminiSummary(usage: GeminiTelemetryUsage): string | null {
	const parts = SUMMARY_FIELDS.filter(([key]) => usage[key] !== undefined).map(
		([key, label]) => `${label}=${usage[key]}`,
	);
	return parts.length > 0 ? `[telemetry] ${parts.join(" ")}` : null;
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

	getCommandExtension(): string {
		return ".toml";
	}

	canUseSymlink(): boolean {
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
		const usage: GeminiTelemetryUsage = {};
		try {
			const content = await fs.readFile(telemetryFile, "utf-8");
			for (const obj of parseJsonObjects(content)) {
				processMetricObject(obj, usage);
			}
		} catch {
			return;
		}
		const summary = formatGeminiSummary(usage);
		if (summary) {
			onOutput(`\n${summary}\n`);
			// Output summary to console log (captured by startConsoleLog)
			process.stdout.write(`${summary}\n`);
		}
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
			`gauntlet-gemini-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		// Use cwd for telemetry file — Gemini's --sandbox restricts writes
		// to the project directory, so os.tmpdir() would fail with EPERM.
		const telemetryFile = path.join(
			process.cwd(),
			`.gauntlet-gemini-telemetry-${process.pid}-${Date.now()}.log`,
		);

		const telemetryEnv: Record<string, string> = {};
		if (!process.env.GEMINI_TELEMETRY_ENABLED) {
			telemetryEnv.GEMINI_TELEMETRY_ENABLED = "true";
		}
		if (!process.env.GEMINI_TELEMETRY_TARGET) {
			telemetryEnv.GEMINI_TELEMETRY_TARGET = "local";
		}
		if (!process.env.GEMINI_TELEMETRY_OUTFILE) {
			telemetryEnv.GEMINI_TELEMETRY_OUTFILE = telemetryFile;
		}

		const args = [
			"--sandbox",
			"--allowed-tools",
			"read_file,list_directory,glob,search_file_content",
			"--output-format",
			"text",
		];

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});
		const cleanupTelemetry = () => fs.unlink(telemetryFile).catch(() => {});

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
			const cmd = `gemini --sandbox --allowed-tools read_file,list_directory,glob,search_file_content --output-format text < "${tmpFile}"`;
			const { stdout } = await execAsync(cmd, {
				timeout: opts.timeoutMs,
				maxBuffer: MAX_BUFFER_BYTES,
				env: { ...process.env, ...telemetryEnv },
			});
			return stdout;
		} finally {
			await cleanup();
			await cleanupTelemetry();
		}
	}
}
