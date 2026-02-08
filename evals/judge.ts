import { getAdapter } from "../src/cli-adapters/index.js";
import { buildJudgePrompt } from "./judge-prompt.js";
import { parseTelemetry } from "./parse-telemetry.js";
import type {
	AdapterViolation,
	EvalAdapterName,
	GroundTruthIssue,
	JudgeResult,
} from "./types.js";

export async function judgeRun(
	violations: AdapterViolation[],
	groundTruth: GroundTruthIssue[],
	judgeAdapterName: EvalAdapterName,
	thinkingBudget: string,
): Promise<JudgeResult> {
	const adapter = getAdapter(judgeAdapterName);
	if (!adapter) {
		throw new Error(`Judge adapter "${judgeAdapterName}" not found`);
	}

	const prompt = buildJudgePrompt(groundTruth, violations);

	const judgeTelemetry: string[] = [];
	const rawOutput = await adapter.execute({
		prompt,
		diff: "",
		allowToolUse: false,
		thinkingBudget,
		timeoutMs: 120_000,
		onOutput: (chunk) => judgeTelemetry.push(chunk),
	});

	// Parse the judge's JSON response — prefer fenced code block, fall back to brace extraction
	const parsed = parseJudgeResponse(rawOutput);

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
		telemetrySummary: parseTelemetry(judgeTelemetry),
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
			`Judge returned malformed JSON: ${err instanceof Error ? err.message : err}`,
		);
	}
}
