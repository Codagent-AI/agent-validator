import type { AdapterViolation } from "./types.js";

interface ParsedOutput {
	status: "pass" | "fail" | "error";
	violations: AdapterViolation[];
}

export function parseAdapterOutput(raw: string): ParsedOutput {
	// Try markdown code block first: ```json ... ```
	const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (codeBlockMatch?.[1]) {
		const parsed = tryParseJson(codeBlockMatch[1]);
		if (parsed) return normalize(parsed);
	}

	// Try finding a JSON object with "status" field
	const jsonObjects = extractJsonObjects(raw);
	for (const obj of jsonObjects) {
		const parsed = tryParseJson(obj);
		if (parsed?.status) return normalize(parsed);
	}

	// Try first JSON object found
	const first = jsonObjects[0];
	if (first) {
		const parsed = tryParseJson(first);
		if (parsed) return normalize(parsed);
	}

	return { status: "error", violations: [] };
}

function extractJsonObjects(text: string): string[] {
	const results: string[] = [];
	let depth = 0;
	let start = -1;

	for (let i = 0; i < text.length; i++) {
		if (text[i] === "{") {
			if (depth === 0) start = i;
			depth++;
		} else if (text[i] === "}") {
			depth--;
			if (depth === 0 && start !== -1) {
				results.push(text.slice(start, i + 1));
				start = -1;
			}
		}
	}

	return results;
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

function normalize(obj: Record<string, unknown>): ParsedOutput {
	const status =
		obj.status === "pass" ? "pass" : obj.status === "fail" ? "fail" : "error";
	const violations: AdapterViolation[] = [];

	if (Array.isArray(obj.violations)) {
		for (const v of obj.violations) {
			if (typeof v === "object" && v !== null) {
				violations.push({
					file: String(v.file ?? ""),
					line: Number(v.line ?? 0),
					issue: String(v.issue ?? ""),
					fix: v.fix ? String(v.fix) : undefined,
					priority: String(v.priority ?? "medium"),
					status: String(v.status ?? "new"),
				});
			}
		}
	}

	return { status, violations };
}
