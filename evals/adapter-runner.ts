import { getAdapter } from "../src/cli-adapters/index.js";
import {
	AdapterExecutionFailure,
	type AdapterTelemetry,
	type CLIAdapter,
	isUsageLimit,
} from "../src/cli-adapters/shared.js";
import { computeRunCost } from "./cost.js";
import { parseAdapterOutput } from "./parse-output.js";
import { parseTelemetry } from "./parse-telemetry.js";
import type { AdapterRunResult, EvalConfiguration } from "./types.js";

export async function runAdapter(
	config: EvalConfiguration,
	prompt: string,
	diff: string,
	timeoutMs: number,
	resolveAdapter: (name: string) => CLIAdapter | undefined = getAdapter,
): Promise<AdapterRunResult> {
	const adapter = resolveAdapter(config.adapter);
	if (!adapter) {
		return errorResult(config, 0, `Adapter "${config.adapter}" not found`);
	}

	const telemetry: string[] = [];
	let latestTelemetry: AdapterTelemetry | undefined;
	const start = Date.now();

	try {
		const execution = await adapter.execute({
			prompt,
			diff,
			model: config.model,
			allowToolUse: config.allowToolUse,
			thinkingBudget: config.thinkingBudget,
			timeoutMs,
			onOutput: (chunk) => telemetry.push(chunk),
			onTelemetry: (value) => {
				latestTelemetry = value;
			},
		});

		const durationMs = Date.now() - start;
		const usage = withUsage(config, telemetry, execution.telemetry);

		const rawOutput = execution.text;
		if (isUsageLimit(rawOutput)) {
			return {
				...errorResult(config, durationMs, "Usage limit reached"),
				rawOutput,
				...usage,
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
			...usage,
		};
	} catch (err) {
		const failureTelemetry =
			err instanceof AdapterExecutionFailure ? err.telemetry : latestTelemetry;
		return {
			...errorResult(
				config,
				Date.now() - start,
				err instanceof Error ? err.message : String(err),
			),
			...withUsage(config, telemetry, failureTelemetry),
		};
	}
}

/** Token and cost fields shared by every run outcome that reached the adapter. */
function withUsage(
	config: EvalConfiguration,
	telemetry: string[],
	adapterTelemetry: AdapterTelemetry | undefined,
): Pick<
	AdapterRunResult,
	"telemetry" | "telemetrySummary" | "adapterTelemetry" | "cost"
> {
	const telemetrySummary = parseTelemetry(telemetry);
	return {
		telemetry,
		telemetrySummary,
		adapterTelemetry,
		cost: computeRunCost(adapterTelemetry, config.model, telemetrySummary),
	};
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
