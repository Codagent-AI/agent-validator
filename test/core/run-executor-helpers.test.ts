import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as appLogger from "../../src/output/app-logger.js";
import * as debugLog from "../../src/utils/debug-log.js";
import * as logParser from "../../src/utils/log-parser.js";
import * as shared from "../../src/commands/shared.js";
import * as executionState from "../../src/utils/execution-state.js";
import { ChangeDetector } from "../../src/core/change-detector.js";
import {
	detectAndPrepareChanges,
	handleNoChanges,
} from "../../src/core/run-executor-helpers.js";

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
			checks: {},
			reviews: {},
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
	let writeStateSpy: ReturnType<typeof spyOn>;

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
		writeStateSpy = spyOn(
			executionState,
			"writeExecutionState",
		).mockResolvedValue(undefined as any);
	});

	afterEach(() => {
		loggerSpy.mockRestore();
		debugLogSpy.mockRestore();
		hasSkippedSpy.mockRestore();
		cleanLogsSpy.mockRestore();
		writeStateSpy.mockRestore();
	});

	it("returns 'passed' when failuresMap is empty", async () => {
		const ctx = makeCtx();
		const failuresMap = new Map();
		const result = await handleNoChanges(ctx, failuresMap);
		expect(result.status).toBe("passed");
	});

	it("writes execution state AFTER cleanLogs when passed", async () => {
		const callOrder: string[] = [];
		cleanLogsSpy.mockImplementation(async () => {
			callOrder.push("cleanLogs");
		});
		writeStateSpy.mockImplementation(async () => {
			callOrder.push("writeExecutionState");
		});
		const ctx = makeCtx();
		const failuresMap = new Map();
		await handleNoChanges(ctx, failuresMap);
		expect(callOrder).toEqual(["cleanLogs", "writeExecutionState"]);
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
});

describe("detectAndPrepareChanges", () => {
	let loggerSpy: ReturnType<typeof spyOn>;
	let getChangedFilesSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		loggerSpy = spyOn(appLogger, "getCategoryLogger").mockReturnValue(
			noopLogger,
		);
		getChangedFilesSpy = spyOn(
			ChangeDetector.prototype,
			"getChangedFiles",
		).mockResolvedValue([]);
	});

	afterEach(() => {
		loggerSpy.mockRestore();
		getChangedFilesSpy.mockRestore();
	});

	it("reruns previous check failures when rerun mode has no file changes", async () => {
		const ctx = makeCtx();
		ctx.config.project.entry_points = [{ path: ".", checks: ["build"] }];
		ctx.config.checks = {
			build: {
				name: "build",
				command: "bun test",
				parallel: true,
				run_locally: true,
				run_in_ci: true,
			},
		};
		const failuresMap = new Map([
			[
				"check_._build",
				new Map([
					[
						"check",
						[{ file: "check", line: 0, issue: "Check failed" }],
					],
				]),
			],
		]);

		const result = await detectAndPrepareChanges(
			ctx,
			true,
			failuresMap,
			{ uncommitted: true, fixBase: "validated-tree" },
		);

		if ("earlyResult" in result) throw new Error("Expected jobs");
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs[0]?.id).toBe("check:.:build");
		expect(result.changeOpts).toEqual({
			uncommitted: true,
			fixBase: "validated-tree",
		});
	});

	it("keeps review failures outstanding when rerun mode has no file changes", async () => {
		const ctx = makeCtx();
		ctx.config.project.entry_points = [{ path: ".", reviews: ["quality"] }];
		ctx.config.reviews = {
			quality: {
				name: "quality",
				prompt: "quality.md",
				num_reviews: 1,
				parallel: true,
				run_locally: true,
				run_in_ci: true,
				enabled: true,
			},
		};
		const failuresMap = new Map([
			[
				"review_._quality",
				new Map([
					[
						"1",
						[{ file: "src/app.ts", line: 1, issue: "Bug" }],
					],
				]),
			],
		]);

		const result = await detectAndPrepareChanges(
			ctx,
			true,
			failuresMap,
			{ uncommitted: true, fixBase: "validated-tree" },
		);

		if (!("earlyResult" in result)) throw new Error("Expected early result");
		expect(result.earlyResult.status).toBe("failed");
		expect(result.earlyResult.message).toContain("still outstanding");
	});
});
