import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ReviewFinding, ValidatorEvidence } from "./types.js";

interface MetricsRecord {
	revision?: number;
	invocation_id?: string;
	attempt_id?: string;
	command?: string;
	provider_reported_costs?: {
		amount?: { value?: number | null };
		scope?: string;
		coverage?: string;
	}[];
}

interface MetricsSnapshot {
	invocations?: MetricsRecord[];
	attempts?: MetricsRecord[];
}

/** Every file under the log directory, archived sessions in `previous` directories included. */
function listFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		// `.metrics/` is private storage; the published snapshots are enough.
		if (entry.isDirectory()) return entry.name === ".metrics" ? [] : listFiles(path);
		return [path];
	});
}

function readJson<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return undefined;
	}
}

/** Latest revision of each record, since the same record appears in several snapshots. */
function latestById(records: MetricsRecord[], key: "invocation_id" | "attempt_id"): MetricsRecord[] {
	const byId = new Map<string, MetricsRecord>();
	for (const record of records) {
		const id = record[key];
		if (!id) continue;
		const existing = byId.get(id);
		if (!existing || (record.revision ?? 0) >= (existing.revision ?? 0)) byId.set(id, record);
	}
	return [...byId.values()];
}

/** USD for one attempt, or null when no whole-attempt cost was reported. */
export function attemptCostUsd(attempt: MetricsRecord): number | null {
	const costs = (attempt.provider_reported_costs ?? []).filter(
		(c) => c.scope === "attempt" && c.coverage === "full" && typeof c.amount?.value === "number",
	);
	if (costs.length === 0) return null;
	return costs.reduce((sum, c) => sum + (c.amount?.value ?? 0), 0);
}

function collectMetrics(files: string[]) {
	const snapshots = files
		.filter((f) => basename(f) === "validation-metrics.json")
		.map((f) => readJson<MetricsSnapshot>(f))
		.filter((s): s is MetricsSnapshot => s !== undefined);
	const invocations = latestById(snapshots.flatMap((s) => s.invocations ?? []), "invocation_id");
	const attempts = latestById(snapshots.flatMap((s) => s.attempts ?? []), "attempt_id");
	const costs = attempts.map(attemptCostUsd);
	const known = costs.filter((c): c is number => c !== null);
	return {
		validatorRuns: invocations.filter((i) => i.command === "run").length,
		reviewerAttempts: attempts.length,
		reviewerCostedAttempts: known.length,
		// Unknown if any attempt's cost is unknown: never undercount.
		reviewerCostUsd:
			known.length === attempts.length ? known.reduce((sum, c) => sum + c, 0) : null,
	};
}

function collectFindings(files: string[]): ReviewFinding[] {
	return files
		.filter((f) => /^review_.*\.json$/.test(basename(f)))
		.flatMap((f) => {
			const data = readJson<{ violations?: Record<string, unknown>[] }>(f);
			return (data?.violations ?? []).map((v) => ({
				source: basename(f),
				file: String(v.file ?? ""),
				line: Number(v.line ?? 0),
				issue: String(v.issue ?? ""),
				priority: String(v.priority ?? ""),
				status: String(v.status ?? "new"),
				...(typeof v.result === "string" && { result: v.result }),
			}));
		});
}

/** `Status:` line of the most recently written console log. */
function lastStatus(files: string[]): string | null {
	const consoles = files
		.filter((f) => /^console\..*\.log$/.test(basename(f)))
		.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
	for (const file of consoles.reverse()) {
		const match = readFileSync(file, "utf-8").match(/^Status: (.+)$/m);
		if (match?.[1]) return match[1].trim();
	}
	return null;
}

/** Reads what the validator recorded during the lead agent's session. */
export function collectValidatorEvidence(logDir: string): ValidatorEvidence {
	const files = listFiles(logDir);
	return {
		...collectMetrics(files),
		findings: collectFindings(files),
		finalStatus: lastStatus(files),
	};
}
