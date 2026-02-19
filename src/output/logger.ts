import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeJobId } from "../utils/sanitizer.js";

function formatTimestamp(): string {
	return new Date().toISOString();
}

/**
 * Compute the global run number for the log directory.
 * Finds the highest run-number suffix across ALL log files and returns max+1.
 */
async function computeGlobalRunNumber(logDir: string): Promise<number> {
	try {
		const files = await fs.readdir(logDir);
		let max = 0;
		for (const file of files) {
			if (!(file.endsWith(".log") || file.endsWith(".json"))) continue;
			// Pattern: <anything>.<number>.(log|json)
			const m = file.match(/\.(\d+)\.(log|json)$/);
			if (m?.[1]) {
				const n = parseInt(m[1], 10);
				if (n > max) max = n;
			}
		}
		return max + 1;
	} catch {
		return 1;
	}
}

export class Logger {
	private initializedFiles: Set<string> = new Set();
	private globalRunNumber: number | null = null;

	constructor(private logDir: string) {}

	async init() {
		await fs.mkdir(this.logDir, { recursive: true });
		this.globalRunNumber = await computeGlobalRunNumber(this.logDir);
	}

	async close() {
		// No-op - using append mode
	}

	getRunNumber(): number {
		return this.globalRunNumber ?? 1;
	}

	async getLogPath(
		jobId: string,
		adapterName?: string,
		reviewIndex?: number,
	): Promise<string> {
		const safeName = sanitizeJobId(jobId);
		const runNum = this.globalRunNumber ?? 1;

		let filename: string;
		if (adapterName && reviewIndex !== undefined) {
			// Review gate with index: <jobId>_<adapter>@<index>.<runNum>.log
			filename = `${safeName}_${adapterName}@${reviewIndex}.${runNum}.log`;
		} else if (adapterName) {
			// Review gate without explicit index (backwards compat for single review)
			filename = `${safeName}_${adapterName}@1.${runNum}.log`;
		} else {
			// Check gate: <jobId>.<runNum>.log
			filename = `${safeName}.${runNum}.log`;
		}

		return path.join(this.logDir, filename);
	}

	private async initFile(logPath: string): Promise<void> {
		if (this.initializedFiles.has(logPath)) {
			return;
		}
		this.initializedFiles.add(logPath);
		await fs.writeFile(logPath, "");
	}

	async createJobLogger(
		jobId: string,
	): Promise<(text: string) => Promise<void>> {
		const logPath = await this.getLogPath(jobId);
		await this.initFile(logPath);

		return async (text: string) => {
			const timestamp = formatTimestamp();
			const lines = text.split("\n");
			if (lines.length > 0) {
				lines[0] = `[${timestamp}] ${lines[0]}`;
			}
			await fs.appendFile(
				logPath,
				lines.join("\n") + (text.endsWith("\n") ? "" : "\n"),
			);
		};
	}

	createLoggerFactory(
		jobId: string,
	): (
		adapterName?: string,
		reviewIndex?: number,
	) => Promise<{ logger: (text: string) => Promise<void>; logPath: string }> {
		return async (adapterName?: string, reviewIndex?: number) => {
			const logPath = await this.getLogPath(jobId, adapterName, reviewIndex);
			await this.initFile(logPath);

			const logger = async (text: string) => {
				const timestamp = formatTimestamp();
				const lines = text.split("\n");
				if (lines.length > 0) {
					lines[0] = `[${timestamp}] ${lines[0]}`;
				}
				await fs.appendFile(
					logPath,
					lines.join("\n") + (text.endsWith("\n") ? "" : "\n"),
				);
			};

			return { logger, logPath };
		};
	}
}
