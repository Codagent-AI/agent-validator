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

interface DataPoint {
	attributes?: Array<{ key: string; value?: { stringValue?: string } }>;
	asInt?: number;
	asDouble?: number;
	sum?: number;
	value?: number;
}

function extractTokenType(dp: DataPoint): TokenType | null {
	const attr = dp.attributes?.find(
		(a) => a.key === "type" || a.key === "gen_ai.token.type",
	);
	const type = attr?.value?.stringValue;
	return type && type in TOKEN_TYPE_MAP ? (type as TokenType) : null;
}

function extractValue(dp: DataPoint): number {
	return dp.asInt || dp.asDouble || dp.sum || dp.value || 0;
}

function processDataPoints(
	dataPoints: DataPoint[],
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

interface OtlpMetric {
	name: string;
	sum?: { dataPoints?: DataPoint[] };
	histogram?: { dataPoints?: DataPoint[] };
}

function getMetricsFromOtlp(data: unknown): OtlpMetric[] {
	const obj = data as {
		resourceMetrics?: Array<{
			scopeMetrics?: Array<{ metrics?: OtlpMetric[] }>;
		}>;
	};
	return obj?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics ?? [];
}

function getDataPoints(metric: OtlpMetric): DataPoint[] {
	return metric.sum?.dataPoints ?? metric.histogram?.dataPoints ?? [];
}

function processMetric(metric: OtlpMetric, usage: GeminiTelemetryUsage): void {
	if (!TOKEN_METRIC_NAMES.has(metric.name)) return;
	processDataPoints(getDataPoints(metric), usage);
}

function parseJsonLine(line: string, usage: GeminiTelemetryUsage): void {
	const data = JSON.parse(line);
	for (const metric of getMetricsFromOtlp(data)) {
		processMetric(metric, usage);
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

	for (const line of content.trim().split("\n").filter(Boolean)) {
		try {
			parseJsonLine(line, usage);
		} catch {
			// Skip malformed lines
		}
	}

	return usage;
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
		const { frontmatter, body } =
			this.parseMarkdownWithFrontmatter(markdownContent);
		const description =
			frontmatter.description || "Run the gauntlet verification suite";

		return `description = ${JSON.stringify(description)}
prompt = """
${body.trim()}
"""
`;
	}

	private parseMarkdownWithFrontmatter(content: string): {
		frontmatter: Record<string, string>;
		body: string;
	} {
		const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) return { frontmatter: {}, body: content };

		const frontmatter: Record<string, string> = {};
		for (const line of (match[1] ?? "").split("\n")) {
			const kv = line.match(/^([^:]+):\s*(.*)$/);
			if (kv?.[1] && kv[2] !== undefined) {
				frontmatter[kv[1].trim()] = kv[2].trim();
			}
		}

		return { frontmatter, body: match[2] ?? "" };
	}

	private buildEnv(telemetryFile: string): Record<string, string> {
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

	private async logTelemetry(
		telemetryFile: string,
		onOutput: (chunk: string) => void,
	): Promise<void> {
		if (process.env.GEMINI_TELEMETRY_OUTFILE) return;
		const usage = await parseGeminiTelemetry(telemetryFile);
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

		const telemetryFile = path.join(
			tmpDir,
			`gauntlet-gemini-telemetry-${process.pid}-${Date.now()}.log`,
		);

		const telemetryEnv = this.buildEnv(telemetryFile);

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
