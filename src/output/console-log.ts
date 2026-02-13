import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";

// biome-ignore lint/suspicious/noControlCharactersInRegex: Required for ANSI escape code stripping
const ANSI_REGEX = /\x1b(?:\[[0-9;?]*[A-Za-z]|[78])/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_REGEX, "");
}

function formatArgs(args: unknown[]): string {
	return args
		.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 4 })))
		.join(" ");
}

function openLogFileExclusive(
	logDir: string,
	runNum: number,
): { fd: number; logPath: string } {
	const logPath = path.join(logDir, `console.${runNum}.log`);
	try {
		const fd = fs.openSync(
			logPath,
			fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
		);
		return { fd, logPath };
	} catch (e: unknown) {
		const error = e as { code?: string };
		if (error.code === "EEXIST") {
			// If file exists, something is wrong with our numbering logic
			// Log warning and try incrementing as fallback
			console.error(`Warning: console.${runNum}.log already exists`);
			return openLogFileFallback(logDir, runNum + 1);
		}
		throw e;
	}
}

function openLogFileFallback(
	logDir: string,
	startNum: number,
): { fd: number; logPath: string } {
	let runNum = startNum;
	for (let attempts = 0; attempts < 100; attempts++) {
		const logPath = path.join(logDir, `console.${runNum}.log`);
		try {
			const fd = fs.openSync(
				logPath,
				fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
			);
			return { fd, logPath };
		} catch (e: unknown) {
			const error = e as { code?: string };
			if (error.code === "EEXIST") {
				runNum++;
				continue;
			}
			throw e;
		}
	}
	throw new Error("Failed to create console log file after 100 attempts");
}

export interface ConsoleLogHandle {
	/** Restore original console functions */
	restore: () => void;
	/** Write directly to the log file without terminal output */
	writeToLogOnly: (text: string) => void;
}

/**
 * Start console logging with unified run numbering.
 * @param logDir The directory to write logs to
 * @param runNumber The run number from Logger (ensures console.N.log matches check.N.log)
 */
export async function startConsoleLog(
	logDir: string,
	runNumber: number,
): Promise<ConsoleLogHandle> {
	await fsPromises.mkdir(logDir, { recursive: true });
	const { fd } = openLogFileExclusive(logDir, runNumber);

	try {
		const originalLog = console.log;
		const originalError = console.error;
		const originalWarn = console.warn;
		const originalStdoutWrite = process.stdout.write.bind(process.stdout);
		const originalStderrWrite = process.stderr.write.bind(process.stderr);

		let isClosed = false;

		function writeToLog(text: string): void {
			if (isClosed) return;
			try {
				fs.writeSync(fd, stripAnsi(text));
			} catch {
				// Suppress logging failures to prevent crashing the application
			}
		}

		// Only patch console methods in bun (bun's console.log bypasses stdout.write)
		// In Node.js, console.log goes through stdout.write, so patching both would cause double logging
		const isBun = typeof globalThis.Bun !== "undefined";
		if (isBun) {
			console.log = (...args: unknown[]) => {
				writeToLog(`${formatArgs(args)}\n`);
				originalLog(...args);
			};

			console.error = (...args: unknown[]) => {
				writeToLog(`${formatArgs(args)}\n`);
				originalError(...args);
			};

			console.warn = (...args: unknown[]) => {
				writeToLog(`${formatArgs(args)}\n`);
				originalWarn(...args);
			};
		}

		process.stdout.write = ((
			chunk: string | Uint8Array,
			...args: unknown[]
		): boolean => {
			const text =
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			writeToLog(text);
			return originalStdoutWrite(chunk, ...(args as []));
		}) as typeof process.stdout.write;

		process.stderr.write = ((
			chunk: string | Uint8Array,
			...args: unknown[]
		): boolean => {
			const text =
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			writeToLog(text);
			return originalStderrWrite(chunk, ...(args as []));
		}) as typeof process.stderr.write;

		return {
			restore: () => {
				isClosed = true;
				if (isBun) {
					console.log = originalLog;
					console.error = originalError;
					console.warn = originalWarn;
				}
				process.stdout.write = originalStdoutWrite;
				process.stderr.write = originalStderrWrite;
				try {
					fs.closeSync(fd);
				} catch {
					// Ignore close errors
				}
			},
			writeToLogOnly: (text: string) => {
				writeToLog(text);
			},
		};
	} catch (error) {
		fs.closeSync(fd);
		throw error;
	}
}
