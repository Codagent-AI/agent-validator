#!/usr/bin/env bun
/**
 * Gauntlet Status Script
 *
 * Parses the configured log_dir (default: gauntlet_logs/) to produce a structured
 * summary of the most recent gauntlet session from the .debug.log, plus a file
 * inventory of all log/JSON files for further inspection.
 *
 * This script handles structured data only (debug log events). Detailed failure
 * analysis (reading individual check logs, review JSONs) is left to the caller
 * (the /gauntlet-status skill) since log formats vary by check type.
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

function parseDebugLog(content: string, sessionStartTime?: Date): SessionRun[] {
	const lines = content.split("\n").filter((l) => l.trim());
	const sessions: SessionRun[] = [];
	let current: SessionRun | null = null;

	for (const line of lines) {
		const event = parseEventType(line);
		const body = parseEventBody(line);
		const ts = parseTimestamp(line);

		switch (event) {
			case "RUN_START": {
				// Skip runs that predate the current session's log files
				if (sessionStartTime && new Date(ts) < sessionStartTime) {
					current = null;
					break;
				}
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

/**
 * Find the earliest mtime of non-hidden log files in the directory.
 * This marks the start of the current session.
 */
function getSessionStartTime(logDir: string): Date | undefined {
	const entries = fs.readdirSync(logDir).filter((f) => !f.startsWith(".") && f !== "previous");
	let earliest: number | undefined;
	for (const entry of entries) {
		const mtime = fs.statSync(path.join(logDir, entry)).mtimeMs;
		if (earliest === undefined || mtime < earliest) {
			earliest = mtime;
		}
	}
	return earliest !== undefined ? new Date(earliest) : undefined;
}

// --- File inventory ---

function formatFileInventory(logDir: string): string[] {
	const lines: string[] = [];
	const entries = fs.readdirSync(logDir).filter((f) => !f.startsWith(".") && f !== "previous");
	if (entries.length === 0) return lines;

	const checks: string[] = [];
	const reviews: string[] = [];
	const other: string[] = [];

	for (const entry of entries.sort()) {
		const fullPath = path.join(logDir, entry);
		const stat = fs.statSync(fullPath);
		const sizeKB = (stat.size / 1024).toFixed(1);
		const line = `- ${fullPath} (${sizeKB} KB)`;

		if (entry.startsWith("review_")) {
			reviews.push(line);
		} else if (entry.startsWith("check_")) {
			checks.push(line);
		} else {
			other.push(line);
		}
	}

	lines.push("### Log Files");
	lines.push("");
	if (checks.length > 0) {
		lines.push("**Check logs:**");
		lines.push(...checks);
	}
	if (reviews.length > 0) {
		lines.push("**Review logs/JSON:**");
		lines.push(...reviews);
	}
	if (other.length > 0) {
		lines.push("**Other:**");
		lines.push(...other);
	}
	lines.push("");

	return lines;
}

// --- Summary output ---

function formatStatusLine(end: RunEnd): string {
	return end.status === "pass"
		? "PASSED"
		: end.status === "fail"
			? "FAILED"
			: end.status.toUpperCase();
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

function formatSession(sessions: SessionRun[], logDir: string): string {
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

	// File inventory
	lines.push(...formatFileInventory(logDir));

	// All sessions summary (if multiple runs)
	if (sessions.length > 1) {
		lines.push(...formatAllRuns(sessions));
	}

	return lines.join("\n");
}

// --- Main ---

/**
 * Read the configured log_dir from .gauntlet/config.yml.
 * Falls back to "gauntlet_logs" if not found.
 */
function getLogDir(cwd: string): string {
	const configPath = path.join(cwd, ".gauntlet", "config.yml");
	try {
		const content = fs.readFileSync(configPath, "utf-8");
		const match = content.match(/^log_dir:\s*(.+)$/m);
		if (match?.[1]) return match[1].trim();
	} catch {
		// Config not found — use default
	}
	return "gauntlet_logs";
}

function main(): void {
	const cwd = process.cwd();
	const logDirName = getLogDir(cwd);
	const activeDir = path.join(cwd, logDirName);
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
		// Fall back to previous directory — cleanLogs archives files directly here
		const prevEntries = fs.readdirSync(previousDir);
		const hasDirectFiles = prevEntries.some(
			(f) => f.endsWith(".log") || f.endsWith(".json"),
		);

		if (hasDirectFiles) {
			logDir = previousDir;
		} else {
			// Legacy: check for timestamped subdirectories
			const prevDirs = prevEntries
				.map((d) => path.join(previousDir, d))
				.filter((d) => fs.statSync(d).isDirectory())
				.sort()
				.reverse();

			if (prevDirs.length === 0) {
				console.log("No gauntlet logs found.");
				process.exit(0);
			}

			logDir = prevDirs[0]!;
		}
		// Debug log stays in the main gauntlet_logs dir, not in previous/
		debugLogPath = path.join(activeDir, debugLogName);
	} else {
		console.log("No gauntlet_logs directory found.");
		process.exit(0);
	}

	// Parse debug log, filtering to current session based on log file timestamps
	let sessions: SessionRun[] = [];
	if (fs.existsSync(debugLogPath)) {
		const debugContent = fs.readFileSync(debugLogPath, "utf-8");
		const sessionStart = getSessionStartTime(logDir);
		sessions = parseDebugLog(debugContent, sessionStart);
	}

	// Format and output
	const output = formatSession(sessions, logDir);
	console.log(output);
}

main();
