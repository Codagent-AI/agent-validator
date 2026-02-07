import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const TEST_DIR = path.join(process.cwd(), `test-status-${Date.now()}`);
const SCRIPT_PATH = path.resolve("src/scripts/status.ts");

function runStatus(cwd: string): string {
	return execSync(`bun ${SCRIPT_PATH}`, {
		cwd,
		encoding: "utf-8",
		env: { ...process.env },
	});
}

describe("Status Script", () => {
	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	afterEach(async () => {
		await fs
			.rm(path.join(TEST_DIR, "gauntlet_logs"), {
				recursive: true,
				force: true,
			})
			.catch(() => {});
	});

	it("should handle missing log directory gracefully", () => {
		const output = runStatus(TEST_DIR);
		expect(output).toContain("No gauntlet_logs directory found");
	});

	it("should handle empty log directory gracefully", async () => {
		await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });
		const output = runStatus(TEST_DIR);
		// No debug log and no non-hidden files => fallback to previous, then no logs
		expect(output).toContain("No gauntlet");
	});

	it("should parse debug log with RUN_START and RUN_END", async () => {
		const logDir = path.join(TEST_DIR, "gauntlet_logs");
		await fs.mkdir(logDir, { recursive: true });

		// Write a sample debug log
		const debugLog = `[2026-02-07T10:00:00.000] RUN_START mode=full base_ref=origin/main files_changed=3 files_new=1 files_modified=2 files_deleted=0 lines_added=50 lines_removed=10 gates=2
[2026-02-07T10:00:05.000] GATE_RESULT check:.:lint status=pass duration=5.0s
[2026-02-07T10:00:30.000] GATE_RESULT review:.:code-quality cli=claude status=fail duration=25.0s violations=3
[2026-02-07T10:00:30.500] RUN_END status=fail fixed=1 skipped=1 failed=3 iterations=2 duration=30.5s
[2026-02-07T10:00:31.000] STOP_HOOK decision=block reason=failed
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);

		// Need at least one non-hidden file for the script to detect active logs
		await fs.writeFile(path.join(logDir, "console.1.log"), "test output\n");

		const output = runStatus(TEST_DIR);

		expect(output).toContain("Gauntlet Session Summary");
		expect(output).toContain("FAILED");
		expect(output).toContain("Iterations:** 2");
		expect(output).toContain("30.5s");
		expect(output).toContain("Fixed:** 1");
		expect(output).toContain("Skipped:** 1");
		expect(output).toContain("Failed:** 3");

		// Diff stats
		expect(output).toContain("Files changed: 3");
		expect(output).toContain("+50 / -10");

		// Gate results
		expect(output).toContain("check:.:lint");
		expect(output).toContain("pass");
		expect(output).toContain("review:.:code-quality");
		expect(output).toContain("FAIL");

		// Stop hook
		expect(output).toContain("block");
		expect(output).toContain("failed");
	});

	it("should parse review JSON files and summarize violations", async () => {
		const logDir = path.join(TEST_DIR, "gauntlet_logs");
		await fs.mkdir(logDir, { recursive: true });

		// Write debug log
		const debugLog = `[2026-02-07T10:00:00.000] RUN_START mode=full files_changed=2 gates=1
[2026-02-07T10:00:10.000] GATE_RESULT review:.:code-quality cli=claude status=fail duration=10.0s violations=2
[2026-02-07T10:00:10.500] RUN_END status=fail fixed=0 skipped=0 failed=2 iterations=1 duration=10.5s
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);

		// Write a console log and review JSON
		await fs.writeFile(path.join(logDir, "console.1.log"), "test\n");
		await fs.writeFile(
			path.join(logDir, "review_._code-quality_claude@1.1.json"),
			JSON.stringify({
				adapter: "claude",
				status: "fail",
				violations: [
					{
						file: "src/main.ts",
						line: 10,
						issue: "Unused variable",
						priority: "medium",
						status: "fixed",
						result: "Removed unused variable",
					},
					{
						file: "src/main.ts",
						line: 20,
						issue: "Missing type annotation",
						priority: "low",
					},
				],
			}),
		);

		const output = runStatus(TEST_DIR);

		expect(output).toContain("Violations Summary");
		expect(output).toContain("Total: 2");
		expect(output).toContain("Fixed: 1");
		expect(output).toContain("Outstanding: 1");
		expect(output).toContain("Missing type annotation");
	});

	it("should fall back to previous/ directory when no active logs exist", async () => {
		const logDir = path.join(TEST_DIR, "gauntlet_logs");
		const prevDir = path.join(logDir, "previous", "2026-02-07_session1");
		await fs.mkdir(prevDir, { recursive: true });

		// Debug log stays in the main gauntlet_logs dir
		const debugLog = `[2026-02-07T09:00:00.000] RUN_START mode=full files_changed=1 gates=1
[2026-02-07T09:00:05.000] RUN_END status=pass fixed=0 skipped=0 failed=0 iterations=1 duration=5.0s
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);

		// Put non-hidden files only in previous/
		await fs.writeFile(
			path.join(prevDir, "console.1.log"),
			"previous output\n",
		);

		const output = runStatus(TEST_DIR);

		// Should still parse the debug log (it's in the main dir)
		expect(output).toContain("Gauntlet Session Summary");
		expect(output).toContain("PASSED");
	});

	it("should handle multiple runs in a session", async () => {
		const logDir = path.join(TEST_DIR, "gauntlet_logs");
		await fs.mkdir(logDir, { recursive: true });

		const debugLog = `[2026-02-07T10:00:00.000] RUN_START mode=full files_changed=2 gates=1
[2026-02-07T10:00:10.000] RUN_END status=fail fixed=0 skipped=0 failed=1 iterations=1 duration=10.0s
[2026-02-07T10:01:00.000] RUN_START mode=verification files_changed=2 gates=1
[2026-02-07T10:01:08.000] RUN_END status=pass fixed=1 skipped=0 failed=0 iterations=2 duration=8.0s
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);
		await fs.writeFile(path.join(logDir, "console.1.log"), "test\n");

		const output = runStatus(TEST_DIR);

		// Should use the last complete session
		expect(output).toContain("PASSED");
		expect(output).toContain("All Runs in Session");
		expect(output).toContain("mode=full");
		expect(output).toContain("mode=verification");
	});
});
