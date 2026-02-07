import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	extractPrefix,
	findPreviousFailures,
	parseLogFile,
} from "../../src/utils/log-parser.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-log-parser");

describe("extractPrefix", () => {
	it("strips dot-separated run number", () => {
		expect(extractPrefix("check_src_test.2.log")).toBe("check_src_test");
	});

	it("handles first run number", () => {
		expect(extractPrefix("review_src_claude.1.log")).toBe("review_src_claude");
	});

	it("handles multi-digit run numbers", () => {
		expect(extractPrefix("check_src.15.log")).toBe("check_src");
	});

	it("handles non-numbered files as fallback", () => {
		expect(extractPrefix("old_format.log")).toBe("old_format");
	});
});

describe("parseLogFile", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("extracts jobId by stripping run number from filename", async () => {
		const logPath = path.join(TEST_DIR, "review_src_quality_claude.2.log");
		await fs.writeFile(
			logPath,
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: FAIL
1. src/app.ts:42 - Missing error handling
`,
		);

		const result = await parseLogFile(logPath);
		expect(result).not.toBeNull();
		expect(result?.jobId).toBe("review_src_quality_claude");
	});

	it("returns failures for check logs", async () => {
		const logPath = path.join(TEST_DIR, "check_src.1.log");
		await fs.writeFile(
			logPath,
			"Some check output\nResult: fail - Error message",
		);

		const result = await parseLogFile(logPath);
		expect(result).not.toBeNull();
		expect(result?.jobId).toBe("check_src");
		expect(result?.adapterFailures[0]?.adapterName).toBe("check");
	});

	it("returns null for passing review", async () => {
		const logPath = path.join(TEST_DIR, "review_src_claude.1.log");
		await fs.writeFile(
			logPath,
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: PASS
`,
		);

		const result = await parseLogFile(logPath);
		expect(result).toBeNull();
	});
});

describe("findPreviousFailures", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("returns empty for non-existent directory", async () => {
		const result = await findPreviousFailures(
			path.join(TEST_DIR, "nonexistent"),
		);
		expect(result).toEqual([]);
	});

	it("only parses the highest-numbered log per prefix", async () => {
		// Write two runs - run 1 has failure, run 2 passes
		await fs.writeFile(
			path.join(TEST_DIR, "review_src_claude.1.log"),
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: FAIL
1. src/app.ts:10 - Old issue
`,
		);

		await fs.writeFile(
			path.join(TEST_DIR, "review_src_claude.2.log"),
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: PASS
`,
		);

		const result = await findPreviousFailures(TEST_DIR);
		// Run 2 passes, so no failures returned
		expect(result).toEqual([]);
	});

	it("returns failures from highest-numbered log", async () => {
		await fs.writeFile(
			path.join(TEST_DIR, "review_src_claude.1.log"),
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: PASS
`,
		);

		await fs.writeFile(
			path.join(TEST_DIR, "review_src_claude.2.log"),
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: FAIL
1. src/app.ts:42 - New issue
`,
		);

		const result = await findPreviousFailures(TEST_DIR);
		expect(result.length).toBe(1);
		expect(result[0]!.jobId).toBe("review_src_claude");
		expect(result[0]!.adapterFailures[0]?.violations[0]?.issue).toBe("New issue");
	});

	it("groups independently for different prefixes", async () => {
		await fs.writeFile(
			path.join(TEST_DIR, "review_src_claude.1.log"),
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: FAIL
1. src/a.ts:1 - Issue A
`,
		);

		await fs.writeFile(
			path.join(TEST_DIR, "review_lib_claude.1.log"),
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: FAIL
1. lib/b.ts:2 - Issue B
`,
		);

		const result = await findPreviousFailures(TEST_DIR);
		expect(result.length).toBe(2);
	});

	it("respects gate filter", async () => {
		await fs.writeFile(
			path.join(TEST_DIR, "review_src_claude.1.log"),
			`--- Review Output (claude) ---
--- Parsed Result ---
Status: FAIL
1. src/a.ts:1 - Issue A
`,
		);

		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "check output");

		const result = await findPreviousFailures(TEST_DIR, "review");
		expect(result.length).toBe(1);
		expect(result[0]!.jobId).toBe("review_src_claude");
	});
});
