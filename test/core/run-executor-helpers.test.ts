import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as appLogger from "../../src/output/app-logger.js";
import * as debugLog from "../../src/utils/debug-log.js";
import * as logParser from "../../src/utils/log-parser.js";
import * as shared from "../../src/commands/shared.js";
import { handleNoChanges } from "../../src/core/run-executor-helpers.js";

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
} as any;

function makeCtx() {
	return {
		options: {},
		config: {
			project: {
				log_dir: "/tmp/test-logs",
				max_previous_logs: 5,
				entry_points: [],
				cli: "echo",
			},
		},
		loggerInitializedHere: false,
		effectiveBaseBranch: "origin/main",
	} as any;
}

describe("handleNoChanges", () => {
	let loggerSpy: ReturnType<typeof spyOn>;
	let debugLogSpy: ReturnType<typeof spyOn>;
	let hasSkippedSpy: ReturnType<typeof spyOn>;
	let cleanLogsSpy: ReturnType<typeof spyOn>;
	let originalConsoleLog: typeof console.log;
	let stdoutOutput: string[];

	beforeEach(() => {
		loggerSpy = spyOn(appLogger, "getCategoryLogger").mockReturnValue(
			noopLogger,
		);
		debugLogSpy = spyOn(debugLog, "getDebugLogger").mockReturnValue({
			logClean: async () => {},
		} as any);
		hasSkippedSpy = spyOn(
			logParser,
			"hasSkippedViolationsInLogs",
		).mockResolvedValue(false as any);
		cleanLogsSpy = spyOn(shared, "cleanLogs").mockResolvedValue(
			undefined as any,
		);
		originalConsoleLog = console.log;
		stdoutOutput = [];
		console.log = (...args: unknown[]) => {
			stdoutOutput.push(args.map(String).join(" "));
		};
	});

	afterEach(() => {
		loggerSpy.mockRestore();
		debugLogSpy.mockRestore();
		hasSkippedSpy.mockRestore();
		cleanLogsSpy.mockRestore();
		console.log = originalConsoleLog;
	});

	it("returns 'passed' when failuresMap is empty", async () => {
		const ctx = makeCtx();
		const failuresMap = new Map();
		const result = await handleNoChanges(ctx, failuresMap);
		expect(result.status).toBe("passed");
	});

	it("returns 'no_changes' when failuresMap is undefined", async () => {
		const ctx = makeCtx();
		const result = await handleNoChanges(ctx, undefined);
		expect(result.status).toBe("no_changes");
	});

	it("returns 'failed' when failuresMap has outstanding violations", async () => {
		const ctx = makeCtx();
		const failuresMap = new Map();
		const adapterMap = new Map();
		adapterMap.set("lint", [
			{ file: "src/foo.ts", line: 10, issue: "unused var" },
			{ file: "src/bar.ts", line: 20, issue: "missing type" },
		]);
		failuresMap.set("check:lint", adapterMap);

		const result = await handleNoChanges(ctx, failuresMap);
		expect(result.status).toBe("failed");
		expect(result.message).toContain("2");
		expect(result.message).toContain("violation");
		expect(result.gatesRun).toBe(0);
	});

	it("should write 'Status: Passed' to stdout when no changes and no failures", async () => {
		const ctx = makeCtx();
		const failuresMap = new Map();
		await handleNoChanges(ctx, failuresMap);
		const output = stdoutOutput.join(" ");
		expect(output).toContain("Status: Passed");
	});

	it("should write 'Status: Failed' to stdout when violations outstanding", async () => {
		const ctx = makeCtx();
		const failuresMap = new Map();
		const adapterMap = new Map();
		adapterMap.set("lint", [{ file: "a.ts", line: 1, issue: "err" }]);
		failuresMap.set("check:lint", adapterMap);
		await handleNoChanges(ctx, failuresMap);
		const output = stdoutOutput.join(" ");
		expect(output).toContain("Status: Failed");
	});

	it("should write status to stdout when no failuresMap (first run, no changes)", async () => {
		const ctx = makeCtx();
		await handleNoChanges(ctx, undefined);
		const output = stdoutOutput.join(" ");
		expect(output).toContain("Status:");
	});
});
