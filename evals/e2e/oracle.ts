import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { getAdapter } from "../../src/cli-adapters/index.js";
import {
	AdapterExecutionFailure,
	type AdapterTelemetry,
	type CLIAdapter,
} from "../../src/cli-adapters/shared.js";
import { computeRunCost } from "../cost.js";
import { parseJudgeResponse } from "../judge.js";
import type { GroundTruthIssue, RunCost } from "../types.js";
import { buildOraclePrompt, type SourceFile } from "./oracle-prompt.js";
import type {
	E2EConfig,
	FixVerdict,
	IssueVerdict,
	OracleResult,
	Regression,
	SyntaxCheckResult,
} from "./types.js";

const SYNTAX_CHECKERS: Record<string, (file: string) => [string, string[]]> = {
	".ts": (file) => ["bun", ["build", "--no-bundle", file]],
	".py": (file) => ["python3", ["-c", "import ast, sys; ast.parse(open(sys.argv[1]).read())", file]],
	".go": (file) => ["gofmt", ["-e", "-l", file]],
};

/** Parses every final source file; an agent that leaves code that does not parse has broken it. */
export function checkSyntax(repo: string, files: string[]): SyntaxCheckResult[] {
	return files.flatMap((file) => {
		const checker = SYNTAX_CHECKERS[extname(file)];
		if (!checker) return [];
		const [command, args] = checker(join(repo, file));
		const result = spawnSync(command, args, { encoding: "utf-8" });
		if (result.error) return [{ file, ok: true, output: `checker unavailable: ${result.error.message}` }];
		const ok = result.status === 0;
		return [{ file, ok, ...(!ok && { output: (result.stderr || result.stdout).slice(0, 2000) }) }];
	});
}

const VERDICTS = new Set<FixVerdict>(["fixed", "partially_fixed", "not_fixed", "removed"]);
const SEVERITIES = new Set<Regression["severity"]>(["high", "medium", "low"]);

/** Normalizes the judge's JSON; an issue the judge left out counts as not fixed. */
export function parseOracleResponse(
	parsed: Record<string, unknown>,
	groundTruth: GroundTruthIssue[],
): Pick<OracleResult, "issues" | "regressions" | "reasoning"> {
	const byId = new Map<string, IssueVerdict>();
	for (const raw of Array.isArray(parsed.issues) ? parsed.issues : []) {
		const item = raw as Record<string, unknown>;
		const id = String(item.id ?? "");
		const verdict = String(item.verdict ?? "") as FixVerdict;
		if (!id || byId.has(id)) continue;
		byId.set(id, {
			id,
			verdict: VERDICTS.has(verdict) ? verdict : "not_fixed",
			reasoning: String(item.reasoning ?? ""),
		});
	}
	const issues = groundTruth.map(
		(gt) => byId.get(gt.id) ?? { id: gt.id, verdict: "not_fixed" as const, reasoning: "Judge gave no verdict." },
	);
	const regressions = (Array.isArray(parsed.regressions) ? parsed.regressions : []).map((raw) => {
		const item = raw as Record<string, unknown>;
		const severity = String(item.severity ?? "") as Regression["severity"];
		return {
			file: String(item.file ?? ""),
			description: String(item.description ?? ""),
			severity: SEVERITIES.has(severity) ? severity : "medium",
		};
	});
	return { issues, regressions, reasoning: String(parsed.reasoning ?? "") };
}

/** Grades the final code: syntax checks plus a judge verdict per seeded issue. */
export async function runOracle(options: {
	repo: string;
	sourceFiles: string[];
	agentDiff: string;
	groundTruth: GroundTruthIssue[];
	judge: E2EConfig["judge"];
	resolveAdapter?: (name: string) => CLIAdapter | undefined;
}): Promise<OracleResult> {
	const syntax = checkSyntax(options.repo, options.sourceFiles);
	const finalFiles: SourceFile[] = options.sourceFiles.map((path) => ({
		path,
		content: readFileSync(join(options.repo, path), "utf-8"),
	}));
	const prompt = buildOraclePrompt(options.groundTruth, finalFiles, options.agentDiff);
	const adapter = (options.resolveAdapter ?? getAdapter)(options.judge.adapter);
	if (!adapter) {
		return failedOracle(options.groundTruth, syntax, `Judge adapter "${options.judge.adapter}" not found`);
	}

	let latest: AdapterTelemetry | undefined;
	const costOf = (telemetry: AdapterTelemetry | undefined): RunCost =>
		computeRunCost(telemetry, options.judge.model);
	try {
		const execution = await adapter.execute({
			prompt,
			diff: "",
			model: options.judge.model,
			allowToolUse: false,
			thinkingBudget: options.judge.thinking_budget,
			timeoutMs: 900_000,
			onTelemetry: (value) => {
				latest = value;
			},
		});
		const judgeCost = costOf(execution.telemetry);
		try {
			const parsed = parseOracleResponse(parseJudgeResponse(execution.text), options.groundTruth);
			return { ...parsed, syntax, judgeCost };
		} catch (err) {
			return { ...failedOracle(options.groundTruth, syntax, message(err)), judgeCost };
		}
	} catch (err) {
		const telemetry = err instanceof AdapterExecutionFailure ? err.telemetry : latest;
		return { ...failedOracle(options.groundTruth, syntax, message(err)), judgeCost: costOf(telemetry) };
	}
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function failedOracle(
	groundTruth: GroundTruthIssue[],
	syntax: SyntaxCheckResult[],
	error: string,
): OracleResult {
	return {
		issues: groundTruth.map((gt) => ({ id: gt.id, verdict: "not_fixed", reasoning: "Oracle failed." })),
		regressions: [],
		syntax,
		reasoning: "",
		error,
	};
}
