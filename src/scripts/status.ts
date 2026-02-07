#!/usr/bin/env bun
/**
 * Gauntlet Status Script
 *
 * Parses gauntlet_logs/ (or gauntlet_logs/previous/) to produce a structured
 * summary of the most recent gauntlet session.
 *
 * Usage: bun .gauntlet/skills/gauntlet/status/scripts/status.ts
 */

import fs from "node:fs";
import path from "node:path";

// --- Types ---

interface RunStart {
	timestamp: string;
	mode: string;
	baseRef?: string;
	filesChanged: number;
	linesAdded: number;
	linesRemoved: number;
	gates: number;
}

interface GateResult {
	timestamp: string;
	gateId: string;
	cli?: string;
	status: string;
	duration: string;
	violations?: number;
}

interface RunEnd {
	timestamp: string;
	status: string;
	fixed: number;
	skipped: number;
	failed: number;
	iterations: number;
	duration: string;
}

interface StopHookEntry {
	timestamp: string;
	decision: string;
	reason: string;
}

interface SessionRun {
	start: RunStart;
	gates: GateResult[];
	end?: RunEnd;
	stopHook?: StopHookEntry;
}

interface ReviewViolation {
	file?: string;
	line?: number | string;
	issue?: string;
	priority?: string;
	status?: string;
	result?: string;
}

interface ReviewJson {
	adapter?: string;
	status?: string;
	violations?: ReviewViolation[];
}

// --- Parsing helpers ---

function parseKeyValue(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const match of text.matchAll(/(\w+)=(\S+)/g)) {
		const key = match[1];
		const value = match[2];
		if (key && value) result[key] = value;
	}
	return result;
}

function parseTimestamp(line: string): string {
	const m = line.match(/^\[([^\]]+)\]/);
	return m ? m[1]! : "";
}

function parseEventType(line: string): string {
	const m = line.match(/^\[[^\]]+\]\s+(\S+)/);
	return m ? m[1]! : "";
}

function parseEventBody(line: string): string {
	const m = line.match(/^\[[^\]]+\]\s+\S+\s*(.*)/);
	return m ? m[1]! : "";
}

// --- Debug log parsing ---

function parseDebugLog(content: string): SessionRun[] {
	const lines = content.split("\n").filter((l) => l.trim());
	const sessions: SessionRun[] = [];
	let current: SessionRun | null = null;

	for (const line of lines) {
		const event = parseEventType(line);
		const body = parseEventBody(line);
		const ts = parseTimestamp(line);

		switch (event) {
			case "RUN_START": {
				const kv = parseKeyValue(body);
				current = {
					start: {
						timestamp: ts,
						mode: kv.mode ?? "unknown",
						baseRef: kv.base_ref,
						filesChanged: Number(kv.files_changed ?? kv.changes ?? 0),
						linesAdded: Number(kv.lines_added ?? 0),
						linesRemoved: Number(kv.lines_removed ?? 0),
						gates: Number(kv.gates ?? 0),
					},
					gates: [],
				};
				sessions.push(current);
				break;
			}
			case "GATE_RESULT": {
				if (!current) break;
				// Body format: <gateId> [cli=<name>] status=<s> duration=<d> [violations=<n>]
				const gateIdMatch = body.match(/^(\S+)/);
				const kv = parseKeyValue(body);
				current.gates.push({
					timestamp: ts,
					gateId: gateIdMatch ? gateIdMatch[1]! : "unknown",
					cli: kv.cli,
					status: kv.status ?? "unknown",
					duration: kv.duration ?? "?",
					violations:
						kv.violations !== undefined ? Number(kv.violations) : undefined,
				});
				break;
			}
			case "RUN_END": {
				if (!current) break;
				const kv = parseKeyValue(body);
				current.end = {
					timestamp: ts,
					status: kv.status ?? "unknown",
					fixed: Number(kv.fixed ?? 0),
					skipped: Number(kv.skipped ?? 0),
					failed: Number(kv.failed ?? 0),
					iterations: Number(kv.iterations ?? 0),
					duration: kv.duration ?? "?",
				};
				break;
			}
			case "STOP_HOOK": {
				if (!current) break;
				const kv = parseKeyValue(body);
				current.stopHook = {
					timestamp: ts,
					decision: kv.decision ?? "unknown",
					reason: kv.reason ?? "unknown",
				};
				break;
			}
		}
	}

	return sessions;
}

// --- Review JSON parsing ---

function parseReviewFiles(logDir: string): Map<string, ReviewJson> {
	const results = new Map<string, ReviewJson>();
	const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".json"));

	for (const file of files) {
		try {
			const content = fs.readFileSync(path.join(logDir, file), "utf-8");
			const parsed = JSON.parse(content) as ReviewJson;
			results.set(file, parsed);
		} catch {
			// Skip unparseable files
		}
	}
	return results;
}

// --- Summary output ---

function formatStatusLine(end: RunEnd): string {
	const label =
		end.status === "pass"
			? "PASSED"
			: end.status === "fail"
				? "FAILED"
				: end.status.toUpperCase();
	return label;
}

function formatViolationsSummary(reviews: Map<string, ReviewJson>): string[] {
	const lines: string[] = [];
	const allViolations = Array.from(reviews.values()).flatMap(
		(r) => r.violations ?? [],
	);
	const total = allViolations.length;
	const fixed = allViolations.filter((v) => v.status === "fixed").length;
	const skipped = allViolations.filter((v) => v.status === "skipped").length;
	const outstanding = total - fixed - skipped;

	lines.push("### Violations Summary");
	lines.push(`- Total: ${total}`);
	lines.push(`- Fixed: ${fixed}`);
	lines.push(`- Skipped: ${skipped}`);
	lines.push(`- Outstanding: ${outstanding}`);
	lines.push("");

	if (outstanding > 0) {
		lines.push(...formatOutstandingViolations(reviews));
	}
	return lines;
}

function formatOutstandingViolations(
	reviews: Map<string, ReviewJson>,
): string[] {
	const lines: string[] = [];
	lines.push("#### Outstanding Violations");
	for (const [file, review] of reviews) {
		const pending = (review.violations ?? []).filter(
			(v) => v.status !== "fixed" && v.status !== "skipped",
		);
		if (pending.length === 0) continue;
		lines.push(`\n**${file}** (${review.adapter ?? "unknown"}):`);
		for (const v of pending) {
			const loc = v.file ? `${v.file}:${v.line ?? "?"}` : "?";
			lines.push(
				`- [${v.priority ?? "?"}] ${loc}: ${v.issue ?? "no description"}`,
			);
		}
	}
	lines.push("");
	return lines;
}

function formatAllRuns(sessions: SessionRun[]): string[] {
	const lines: string[] = [];
	lines.push("### All Runs in Session");
	lines.push("");
	for (let i = 0; i < sessions.length; i++) {
		const s = sessions[i];
		if (!s) continue;
		const status = s.end ? s.end.status : "in-progress";
		const duration = s.end ? s.end.duration : "?";
		lines.push(
			`${i + 1}. [${s.start.timestamp}] mode=${s.start.mode} status=${status} duration=${duration}`,
		);
	}
	lines.push("");
	return lines;
}

function formatSession(
	sessions: SessionRun[],
	reviews: Map<string, ReviewJson>,
): string {
	if (sessions.length === 0) {
		return "No gauntlet runs found in logs.";
	}

	const lastComplete = [...sessions].reverse().find((s) => s.end);
	const session = lastComplete ?? sessions[sessions.length - 1];
	if (!session) return "No gauntlet runs found in logs.";

	const lines: string[] = [];

	// Header
	lines.push("## Gauntlet Session Summary");
	lines.push("");

	// Overall status
	if (session.end) {
		lines.push(`**Status:** ${formatStatusLine(session.end)}`);
		lines.push(`**Iterations:** ${session.end.iterations}`);
		lines.push(`**Duration:** ${session.end.duration}`);
		lines.push(
			`**Fixed:** ${session.end.fixed} | **Skipped:** ${session.end.skipped} | **Failed:** ${session.end.failed}`,
		);
	} else {
		lines.push("**Status:** In Progress (no RUN_END found)");
	}
	lines.push("");

	// Diff stats
	lines.push("### Diff Stats");
	lines.push(`- Mode: ${session.start.mode}`);
	if (session.start.baseRef) {
		lines.push(`- Base ref: ${session.start.baseRef}`);
	}
	lines.push(`- Files changed: ${session.start.filesChanged}`);
	lines.push(
		`- Lines: +${session.start.linesAdded} / -${session.start.linesRemoved}`,
	);
	lines.push(`- Gates: ${session.start.gates}`);
	lines.push("");

	// Gate results
	lines.push("### Gate Results");
	lines.push("");
	lines.push("| Gate | CLI | Status | Duration | Violations |");
	lines.push("|------|-----|--------|----------|------------|");
	for (const gate of session.gates) {
		const violations =
			gate.violations !== undefined ? String(gate.violations) : "-";
		const statusIcon = gate.status === "pass" ? "pass" : "FAIL";
		lines.push(
			`| ${gate.gateId} | ${gate.cli ?? "-"} | ${statusIcon} | ${gate.duration} | ${violations} |`,
		);
	}
	lines.push("");

	// Stop hook
	if (session.stopHook) {
		lines.push("### Stop Hook");
		lines.push(`- Decision: ${session.stopHook.decision}`);
		lines.push(`- Reason: ${session.stopHook.reason}`);
		lines.push("");
	}

	// Violations summary
	if (reviews.size > 0) {
		lines.push(...formatViolationsSummary(reviews));
	}

	// All sessions summary (if multiple runs)
	if (sessions.length > 1) {
		lines.push(...formatAllRuns(sessions));
	}

	return lines.join("\n");
}

// --- Main ---

function main(): void {
	const cwd = process.cwd();
	const activeDir = path.join(cwd, "gauntlet_logs");
	const previousDir = path.join(activeDir, "previous");
	const debugLogName = ".debug.log";

	// Determine which directory to read from
	let logDir: string;
	let debugLogPath: string;

	// Check active directory first for non-debug log files
	const activeHasLogs =
		fs.existsSync(activeDir) &&
		fs
			.readdirSync(activeDir)
			.some((f) => !f.startsWith(".") && f !== "previous");

	if (activeHasLogs) {
		logDir = activeDir;
		debugLogPath = path.join(activeDir, debugLogName);
	} else if (fs.existsSync(previousDir)) {
		// Fall back to most recent previous directory
		const prevDirs = fs
			.readdirSync(previousDir)
			.map((d) => path.join(previousDir, d))
			.filter((d) => fs.statSync(d).isDirectory())
			.sort()
			.reverse();

		if (prevDirs.length === 0) {
			console.log("No gauntlet logs found.");
			process.exit(0);
		}

		logDir = prevDirs[0]!;
		// Debug log stays in the main gauntlet_logs dir, not in previous/
		debugLogPath = path.join(activeDir, debugLogName);
	} else {
		console.log("No gauntlet_logs directory found.");
		process.exit(0);
	}

	// Parse debug log
	let sessions: SessionRun[] = [];
	if (fs.existsSync(debugLogPath)) {
		const debugContent = fs.readFileSync(debugLogPath, "utf-8");
		sessions = parseDebugLog(debugContent);
	}

	// Parse review JSON files
	const reviews = parseReviewFiles(logDir);

	// Format and output
	const output = formatSession(sessions, reviews);
	console.log(output);
}

main();
