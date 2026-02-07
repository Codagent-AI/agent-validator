import { getAdapter, isUsageLimit } from "../src/cli-adapters/index.js";
import { parseAdapterOutput } from "./parse-output.js";
import type { AdapterRunResult, EvalConfiguration } from "./types.js";

export async function runAdapter(
	config: EvalConfiguration,
	prompt: string,
	diff: string,
	timeoutMs: number,
): Promise<AdapterRunResult> {
	const adapter = getAdapter(config.adapter);
	if (!adapter) {
		return {
			configLabel: config.label,
			adapter: config.adapter,
			runIndex: 0,
			rawOutput: "",
			violations: [],
			status: "error",
			durationMs: 0,
			error: `Adapter "${config.adapter}" not found`,
			telemetry: [],
		};
	}

	const telemetry: string[] = [];
	const start = Date.now();

	try {
		const rawOutput = await adapter.execute({
			prompt,
			diff,
			allowToolUse: config.allowToolUse,
			thinkingBudget: config.thinkingBudget,
			timeoutMs,
			onOutput: (chunk) => telemetry.push(chunk),
		});

		const durationMs = Date.now() - start;

		if (isUsageLimit(rawOutput)) {
			return {
				configLabel: config.label,
				adapter: config.adapter,
				runIndex: 0,
				rawOutput,
				violations: [],
				status: "error",
				durationMs,
				error: "Usage limit reached",
				telemetry,
			};
		}

		const parsed = parseAdapterOutput(rawOutput);

		return {
			configLabel: config.label,
			adapter: config.adapter,
			runIndex: 0,
			rawOutput,
			violations: parsed.violations,
			status: parsed.status,
			durationMs,
			telemetry,
		};
	} catch (err) {
		return {
			configLabel: config.label,
			adapter: config.adapter,
			runIndex: 0,
			rawOutput: "",
			violations: [],
			status: "error",
			durationMs: Date.now() - start,
			error: err instanceof Error ? err.message : String(err),
			telemetry,
		};
	}
}
