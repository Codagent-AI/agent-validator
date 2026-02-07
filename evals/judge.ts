import { getAdapter } from "../src/cli-adapters/index.js";
import { buildJudgePrompt } from "./judge-prompt.js";
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

	const rawOutput = await adapter.execute({
		prompt,
		diff: "",
		allowToolUse: false,
		thinkingBudget,
		timeoutMs: 120_000,
	});

	// Parse the judge's JSON response
	const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("Judge did not return valid JSON");
	}

	const parsed = JSON.parse(jsonMatch[0]);

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
	};
}
