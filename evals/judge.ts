import { getAdapter } from "../src/cli-adapters/index.js";
import {
	AdapterExecutionFailure,
	type AdapterTelemetry,
	type CLIAdapter,
} from "../src/cli-adapters/shared.js";
import { computeRunCost } from "./cost.js";
import { buildJudgePrompt } from "./judge-prompt.js";
import { parseTelemetry } from "./parse-telemetry.js";
import type {
	AdapterViolation,
	EvalAdapterName,
	GroundTruthIssue,
	JudgeResult,
	RunCost,
} from "./types.js";

/** A failed judge call that may still have cost money. */
export class JudgeRunError extends Error {
	constructor(
		message: string,
		readonly cost: RunCost,
	) {
		super(message);
		this.name = "JudgeRunError";
	}
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export async function judgeRun(
	violations: AdapterViolation[],
	groundTruth: GroundTruthIssue[],
	judgeAdapterName: EvalAdapterName,
	thinkingBudget: string,
	options: { model?: string; timeoutMs?: number } | number = {},
	resolveAdapter: (name: string) => CLIAdapter | undefined = getAdapter,
): Promise<JudgeResult> {
	const adapter = resolveAdapter(judgeAdapterName);
	if (!adapter) {
		throw new Error(`Judge adapter "${judgeAdapterName}" not found`);
	}

	const prompt = buildJudgePrompt(groundTruth, violations);
	const model = typeof options === "number" ? undefined : options.model;
	const timeoutMs =
		typeof options === "number" ? options : (options.timeoutMs ?? 300_000);

	const judgeTelemetry: string[] = [];
	let latestTelemetry: AdapterTelemetry | undefined;
	const costOf = (telemetry: AdapterTelemetry | undefined) =>
		computeRunCost(telemetry, model, parseTelemetry(judgeTelemetry));

	let execution: Awaited<ReturnType<typeof adapter.execute>>;
	try {
		execution = await adapter.execute({
			prompt,
			diff: "",
			model,
			allowToolUse: false,
			thinkingBudget,
			timeoutMs,
			onOutput: (chunk) => judgeTelemetry.push(chunk),
			onTelemetry: (value) => {
				latestTelemetry = value;
			},
		});
	} catch (err) {
		const telemetry =
			err instanceof AdapterExecutionFailure ? err.telemetry : latestTelemetry;
		throw new JudgeRunError(errorMessage(err), costOf(telemetry));
	}
	const telemetrySummary = parseTelemetry(judgeTelemetry);
	const cost = costOf(execution.telemetry);

	// Parse the judge's JSON response — prefer fenced code block, fall back to brace extraction
	let parsed: Record<string, unknown>;
	try {
		parsed = parseJudgeResponse(execution.text);
	} catch (err) {
		throw new JudgeRunError(errorMessage(err), cost);
	}

	return {
		matches: Array.isArray(parsed.matches)
			? parsed.matches.map((m: Record<string, unknown>) => ({
					groundTruthId: String(m.groundTruthId ?? ""),
					violationIndex: Number(m.violationIndex ?? 0),
					confidence: String(m.confidence ?? "low") as
						| "high"
						| "medium"
						| "low",
					reasoning: String(m.reasoning ?? ""),
				}))
			: [],
		missedIssues: Array.isArray(parsed.missedIssues)
			? parsed.missedIssues.map(String)
			: [],
		falsePositives: Array.isArray(parsed.falsePositives)
			? parsed.falsePositives.map(Number)
			: [],
		reasoning: String(parsed.reasoning ?? ""),
		telemetrySummary,
		cost,
	};
}

function parseJudgeResponse(raw: string): Record<string, unknown> {
	// Prefer fenced JSON code block
	const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fenced?.[1]) {
		try {
			return JSON.parse(fenced[1].trim());
		} catch {
			// fall through to brace extraction
		}
	}

	// Fall back to outermost brace pair
	const braceMatch = raw.match(/\{[\s\S]*\}/);
	if (!braceMatch) {
		throw new Error("Judge did not return valid JSON");
	}

	try {
		return JSON.parse(braceMatch[0]);
	} catch (err) {
		throw new Error(
			`Judge returned malformed JSON: ${errorMessage(err)}`,
		);
	}
}
