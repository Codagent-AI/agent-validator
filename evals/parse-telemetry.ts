import type { TelemetrySummary } from "./types.js";

const TELEMETRY_PREFIXES = ["[otel]", "[codex-telemetry]", "[telemetry]"];

export function parseTelemetry(chunks: string[]): TelemetrySummary | undefined {
	const joined = chunks.join("\n");
	const lines = findTelemetryLines(joined);
	if (lines.length === 0) return undefined;

	const summaries = lines.map(parseTelemetryLine);
	return sumTelemetry(summaries);
}

function parseTelemetryLine(line: string): TelemetrySummary {
	const cacheRead = extractNumber(line, "cacheRead");
	const cacheWrite = extractNumber(line, "cacheWrite");
	const cacheFallback = extractNumber(line, "cache");
	const cost = extractDollar(line, "cost");

	return {
		inputTokens: extractNumber(line, "in"),
		outputTokens: extractNumber(line, "out"),
		thinkingTokens: extractNumber(line, "thought"),
		cacheTokens: cacheRead + cacheWrite || cacheFallback,
		...(cost !== undefined && { cost }),
		toolCalls: extractNumber(line, "tool_calls"),
		apiRequests: extractNumber(line, "api_requests"),
	};
}

function findTelemetryLines(text: string): string[] {
	return text
		.split("\n")
		.filter((line) => TELEMETRY_PREFIXES.some((p) => line.includes(p)));
}

function extractNumber(line: string, key: string): number {
	const match = line.match(new RegExp(`\\b${key}=(\\d+)`));
	return match ? Number(match[1]) : 0;
}

function extractDollar(line: string, key: string): number | undefined {
	const match = line.match(new RegExp(`\\b${key}=\\$(\\d+\\.?\\d*)`));
	return match ? Number(match[1]) : undefined;
}

export function sumTelemetry(
	summaries: (TelemetrySummary | undefined)[],
): TelemetrySummary {
	const result: TelemetrySummary = {
		inputTokens: 0,
		outputTokens: 0,
		thinkingTokens: 0,
		cacheTokens: 0,
		toolCalls: 0,
		apiRequests: 0,
	};
	let hasCost = false;
	let totalCost = 0;

	for (const s of summaries) {
		if (!s) continue;
		result.inputTokens += s.inputTokens;
		result.outputTokens += s.outputTokens;
		result.thinkingTokens += s.thinkingTokens;
		result.cacheTokens += s.cacheTokens;
		result.toolCalls += s.toolCalls;
		result.apiRequests += s.apiRequests;
		if (s.cost !== undefined) {
			hasCost = true;
			totalCost += s.cost;
		}
	}

	if (hasCost) result.cost = totalCost;
	return result;
}
