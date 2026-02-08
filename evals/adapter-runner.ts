import { getAdapter, isUsageLimit } from "../src/cli-adapters/index.js";
import { parseAdapterOutput } from "./parse-output.js";
import { parseTelemetry } from "./parse-telemetry.js";
import type { AdapterRunResult, EvalConfiguration } from "./types.js";

export async function runAdapter(
	config: EvalConfiguration,
	prompt: string,
	diff: string,
	timeoutMs: number,
): Promise<AdapterRunResult> {
	const adapter = getAdapter(config.adapter);
	if (!adapter) {
		return errorResult(config, 0, `Adapter "${config.adapter}" not found`);
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
				...errorResult(config, durationMs, "Usage limit reached"),
				rawOutput,
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
			telemetrySummary: parseTelemetry(telemetry),
		};
	} catch (err) {
		return {
			...errorResult(
				config,
				Date.now() - start,
				err instanceof Error ? err.message : String(err),
			),
			telemetry,
		};
	}
}

function errorResult(
	config: EvalConfiguration,
	durationMs: number,
	error: string,
): AdapterRunResult {
	return {
		configLabel: config.label,
		adapter: config.adapter,
		runIndex: 0,
		rawOutput: "",
		violations: [],
		status: "error",
		durationMs,
		error,
		telemetry: [],
	};
}
