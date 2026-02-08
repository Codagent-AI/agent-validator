import type { AdapterViolation } from "./types.js";

interface ParsedOutput {
	status: "pass" | "fail" | "error";
	violations: AdapterViolation[];
}

export function parseAdapterOutput(raw: string): ParsedOutput {
	const direct = tryParseJson(raw.trim());
	if (direct) return normalize(direct);

	const fromCodeBlock = tryParseCodeBlock(raw);
	if (fromCodeBlock) return normalize(fromCodeBlock);

	const fromStatusObj = tryParseStatusObject(raw);
	if (fromStatusObj) return normalize(fromStatusObj);

	const fromFirstObj = tryParseFirstObject(raw);
	if (fromFirstObj) return normalize(fromFirstObj);

	return { status: "error", violations: [] };
}

function tryParseCodeBlock(raw: string): Record<string, unknown> | null {
	const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (!match?.[1]) return null;
	return tryParseJson(match[1]);
}

function tryParseStatusObject(raw: string): Record<string, unknown> | null {
	for (const obj of extractJsonObjects(raw)) {
		const parsed = tryParseJson(obj);
		if (parsed?.status) return parsed;
	}
	return null;
}

function tryParseFirstObject(raw: string): Record<string, unknown> | null {
	const objects = extractJsonObjects(raw);
	const first = objects[0];
	if (!first) return null;
	return tryParseJson(first);
}

function extractJsonObjects(text: string): string[] {
	const results: string[] = [];
	let depth = 0;
	let start = -1;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') {
			i = skipQuotedString(text, i);
			continue;
		}
		if (ch === "{" && depth++ === 0) start = i;
		if (ch !== "}") continue;
		depth--;
		if (depth !== 0 || start === -1) continue;
		results.push(text.slice(start, i + 1));
		start = -1;
	}

	return results;
}

function skipQuotedString(text: string, openQuote: number): number {
	for (let i = openQuote + 1; i < text.length; i++) {
		if (text[i] === "\\" && i + 1 < text.length) {
			i++;
		} else if (text[i] === '"') {
			return i;
		}
	}
	return text.length - 1;
}

function tryParseJson(text: string): Record<string, unknown> | null {
	try {
		const obj = JSON.parse(text.trim());
		if (typeof obj === "object" && obj !== null) return obj;
		return null;
	} catch {
		return null;
	}
}

const VALID_STATUSES = new Set<ParsedOutput["status"]>(["pass", "fail"]);

function normalizeStatus(raw: unknown): ParsedOutput["status"] {
	return VALID_STATUSES.has(raw as ParsedOutput["status"])
		? (raw as ParsedOutput["status"])
		: "error";
}

function toViolation(v: Record<string, unknown>): AdapterViolation {
	return {
		file: String(v.file ?? ""),
		line: Number(v.line ?? 0),
		issue: String(v.issue ?? ""),
		fix: v.fix ? String(v.fix) : undefined,
		priority: String(v.priority ?? "medium"),
		status: String(v.status ?? "new"),
	};
}

function normalize(obj: Record<string, unknown>): ParsedOutput {
	const raw = Array.isArray(obj.violations) ? obj.violations : [];
	const violations = raw
		.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
		.map(toViolation);
	return { status: normalizeStatus(obj.status), violations };
}
