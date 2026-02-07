import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
	configure,
	getLogger,
	type LogRecord,
	type Logger as LogTapeLogger,
} from "@logtape/logtape";
import { createConsoleSink } from "./sinks/console-sink.js";

/**
 * Logger modes that determine sink configuration:
 * - "interactive": Console output to stderr (file capture via console-log.ts)
 * - "stop-hook": NO console output (JSON protocol on stdout must be clean)
 * - "ci": Console output to stderr
 */
export type LoggerMode = "interactive" | "stop-hook" | "ci";

/**
 * Log level options.
 */
export type LogLevel = "debug" | "info" | "warning" | "error";

/**
 * App logger configuration options.
 */
export interface AppLoggerConfig {
	mode: LoggerMode;
	logDir?: string;
	level?: LogLevel;
	debugLog?: {
		enabled: boolean;
		maxSizeMb?: number;
	};
}

// Global state for cleanup (file descriptor for debug log, configuration flag)
let debugLogFd: number | null = null;
let isConfigured = false;

/**
 * Safely serialize a value, handling circular references.
 */
function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "[Unserializable]";
	}
}

/**
 * Create a debug log sink that writes to .debug.log file.
 * Format matches existing DebugLogger: [ISO_TIMESTAMP] message
 */
function createDebugLogSink(logDir: string): (record: LogRecord) => void {
	const debugLogPath = path.join(logDir, ".debug.log");

	// Open file for append
	debugLogFd = fs.openSync(
		debugLogPath,
		fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND,
	);

	return (record: LogRecord) => {
		if (debugLogFd === null) return;

		const timestamp = new Date(record.timestamp).toISOString();
		const level = record.level.toUpperCase();
		const category = record.category.join(".");
		const message = record.message
			.map((part) => (typeof part === "string" ? part : safeStringify(part)))
			.join("");

		const line = `[${timestamp}] ${level} [${category}] ${message}\n`;

		try {
			fs.writeSync(debugLogFd, line);
		} catch {
			// Suppress write errors
		}
	};
}

/**
 * Initialize the application logger with LogTape.
 *
 * IMPORTANT: In stop-hook mode, NO console output is generated.
 * stdout must remain clean for the JSON protocol response.
 * File logging is handled separately by console-log.ts which captures stderr.
 *
 * @param config - Logger configuration
 * @returns Promise that resolves when logger is configured
 */
export async function initLogger(config: AppLoggerConfig): Promise<void> {
	// Reset if already configured
	if (isConfigured) {
		await resetLogger();
	}

	const { mode, level = "info", logDir, debugLog } = config;

	// Ensure log directory exists if we need it for debug log
	if (logDir && debugLog?.enabled) {
		await fsPromises.mkdir(logDir, { recursive: true });
	}

	// Build sink configuration
	const sinks: Record<string, (record: LogRecord) => void> = {};
	const activeSinks: string[] = [];

	// Console sink (only for interactive and ci modes)
	// Outputs to stderr, which gets captured by console-log.ts
	if (mode !== "stop-hook") {
		sinks.console = createConsoleSink();
		activeSinks.push("console");
	}

	// Debug log sink (writes directly to .debug.log)
	if (logDir && debugLog?.enabled) {
		sinks.debugLog = createDebugLogSink(logDir);
		activeSinks.push("debugLog");
	}

	// Configure LogTape (reset: true needed if LogTape was previously configured)
	// IMPORTANT: Configure the meta logger to suppress its default stdout output.
	// Without this, LogTape writes "LogTape loggers are configured..." to stdout,
	// which breaks the stop-hook JSON protocol.
	try {
		await configure({
			sinks,
			loggers: [
				{
					category: ["gauntlet"],
					lowestLevel: level,
					sinks: activeSinks,
				},
				{
					// Suppress LogTape's internal meta logger (writes to stdout by default)
					category: ["logtape", "meta"],
					lowestLevel: "fatal",
					sinks: [],
				},
			],
			reset: true,
		});
		isConfigured = true;
	} catch (error) {
		// Close debug log fd if initialization fails to prevent leaks
		if (debugLogFd !== null) {
			try {
				fs.closeSync(debugLogFd);
			} catch {
				// Ignore close errors
			}
			debugLogFd = null;
		}
		throw error;
	}
}

/**
 * Reset the logger configuration and close file handles.
 */
export async function resetLogger(): Promise<void> {
	if (debugLogFd !== null) {
		try {
			fs.closeSync(debugLogFd);
		} catch {
			// Ignore close errors
		}
		debugLogFd = null;
	}

	// Reset LogTape configuration (reset: true required after initial configure)
	// Also suppress meta logger to avoid stdout pollution
	await configure({
		sinks: {},
		loggers: [
			{
				category: ["logtape", "meta"],
				lowestLevel: "fatal",
				sinks: [],
			},
		],
		reset: true,
	});
	isConfigured = false;
}

/**
 * Get the root application logger.
 */
export function getAppLogger(): LogTapeLogger {
	return getLogger(["gauntlet"]);
}

/**
 * Get a child logger for a specific category.
 * Categories are hierarchical, e.g., ["gauntlet", "runner"] or ["gauntlet", "gate", "check"]
 *
 * @param category - The category path (after "gauntlet" prefix)
 */
export function getCategoryLogger(...category: string[]): LogTapeLogger {
	return getLogger(["gauntlet", ...category]);
}

/**
 * Check if the logger has been configured.
 */
export function isLoggerConfigured(): boolean {
	return isConfigured;
}
