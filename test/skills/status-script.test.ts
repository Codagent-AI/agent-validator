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

/** Write a file and set its mtime to a specific date so the session start filter works. */
async function writeFileAt(
	filePath: string,
	content: string,
	date: Date,
): Promise<void> {
	await fs.writeFile(filePath, content);
	await fs.utimes(filePath, date, date);
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
		await fs
			.rm(path.join(TEST_DIR, ".gauntlet"), { recursive: true, force: true })
			.catch(() => {});
		await fs
			.rm(path.join(TEST_DIR, "custom_logs"), {
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

		const sessionTime = new Date("2026-02-07T10:00:00.000Z");

		const debugLog = `[2026-02-07T10:00:00.000] RUN_START mode=full base_ref=origin/main files_changed=3 files_new=1 files_modified=2 files_deleted=0 lines_added=50 lines_removed=10 gates=2
[2026-02-07T10:00:05.000] GATE_RESULT check:.:lint status=pass duration=5.0s
[2026-02-07T10:00:30.000] GATE_RESULT review:.:code-quality cli=claude status=fail duration=25.0s violations=3
[2026-02-07T10:00:30.500] RUN_END status=fail fixed=1 skipped=1 failed=3 iterations=2 duration=30.5s
[2026-02-07T10:00:31.000] STOP_HOOK decision=block reason=failed
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);
		await writeFileAt(
			path.join(logDir, "console.1.log"),
			"test output\n",
			sessionTime,
		);

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

	it("should list log files in file inventory", async () => {
		const logDir = path.join(TEST_DIR, "gauntlet_logs");
		await fs.mkdir(logDir, { recursive: true });

		const sessionTime = new Date("2026-02-07T10:00:00.000Z");

		const debugLog = `[2026-02-07T10:00:00.000] RUN_START mode=full files_changed=2 gates=1
[2026-02-07T10:00:10.000] GATE_RESULT review:.:code-quality cli=claude status=fail duration=10.0s violations=2
[2026-02-07T10:00:10.500] RUN_END status=fail fixed=0 skipped=0 failed=2 iterations=1 duration=10.5s
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);

		await writeFileAt(
			path.join(logDir, "console.1.log"),
			"test\n",
			sessionTime,
		);
		await writeFileAt(
			path.join(logDir, "check_._lint.1.log"),
			"lint output\n",
			sessionTime,
		);
		await writeFileAt(
			path.join(logDir, "review_._code-quality_claude@1.1.json"),
			JSON.stringify({ adapter: "claude", status: "fail", violations: [] }),
			sessionTime,
		);

		const output = runStatus(TEST_DIR);

		// File inventory section
		expect(output).toContain("Log Files");
		expect(output).toContain("Check logs:");
		expect(output).toContain("check_._lint.1.log");
		expect(output).toContain("Review logs/JSON:");
		expect(output).toContain("review_._code-quality_claude@1.1.json");
		expect(output).toContain("Other:");
		expect(output).toContain("console.1.log");
		expect(output).toContain("KB)");
	});

	it("should fall back to previous/ directory when no active logs exist", async () => {
		const logDir = path.join(TEST_DIR, "gauntlet_logs");
		const prevDir = path.join(logDir, "previous", "2026-02-07_session1");
		await fs.mkdir(prevDir, { recursive: true });

		const sessionTime = new Date("2026-02-07T09:00:00.000Z");

		const debugLog = `[2026-02-07T09:00:00.000] RUN_START mode=full files_changed=1 gates=1
[2026-02-07T09:00:05.000] RUN_END status=pass fixed=0 skipped=0 failed=0 iterations=1 duration=5.0s
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);

		await writeFileAt(
			path.join(prevDir, "console.1.log"),
			"previous output\n",
			sessionTime,
		);

		const output = runStatus(TEST_DIR);

		expect(output).toContain("Gauntlet Session Summary");
		expect(output).toContain("PASSED");
	});

	it("should handle multiple runs in a session", async () => {
		const logDir = path.join(TEST_DIR, "gauntlet_logs");
		await fs.mkdir(logDir, { recursive: true });

		const sessionTime = new Date("2026-02-07T10:00:00.000Z");

		const debugLog = `[2026-02-07T10:00:00.000] RUN_START mode=full files_changed=2 gates=1
[2026-02-07T10:00:10.000] RUN_END status=fail fixed=0 skipped=0 failed=1 iterations=1 duration=10.0s
[2026-02-07T10:01:00.000] RUN_START mode=verification files_changed=2 gates=1
[2026-02-07T10:01:08.000] RUN_END status=pass fixed=1 skipped=0 failed=0 iterations=2 duration=8.0s
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);
		await writeFileAt(
			path.join(logDir, "console.1.log"),
			"test\n",
			sessionTime,
		);

		const output = runStatus(TEST_DIR);

		// Should use the last complete session
		expect(output).toContain("PASSED");
		expect(output).toContain("All Runs in Session");
		expect(output).toContain("mode=full");
		expect(output).toContain("mode=verification");
	});

	it("should only show runs matching current session log files", async () => {
		const logDir = path.join(TEST_DIR, "gauntlet_logs");
		await fs.mkdir(logDir, { recursive: true });

		// Log file mtime = Feb 7 (current session)
		const sessionTime = new Date("2026-02-07T10:05:00.000Z");

		// Debug log has old runs (Feb 1, before file mtime) and new runs (Feb 7)
		const debugLog = `[2026-02-01T10:00:00.000] RUN_START mode=full files_changed=2 gates=1
[2026-02-01T10:00:10.000] RUN_END status=fail fixed=0 skipped=0 failed=1 iterations=1 duration=10.0s
[2026-02-01T10:01:00.000] RUN_START mode=verification files_changed=2 gates=1
[2026-02-01T10:01:08.000] RUN_END status=pass fixed=1 skipped=0 failed=0 iterations=2 duration=8.0s
[2026-02-07T10:06:00.000] RUN_START mode=full files_changed=1 gates=1
[2026-02-07T10:06:05.000] GATE_RESULT check:.:lint status=fail duration=5.0s
[2026-02-07T10:06:10.000] RUN_END status=fail fixed=0 skipped=0 failed=1 iterations=1 duration=10.0s
`;
		await fs.writeFile(path.join(logDir, ".debug.log"), debugLog);
		await writeFileAt(
			path.join(logDir, "console.1.log"),
			"test\n",
			sessionTime,
		);

		const output = runStatus(TEST_DIR);

		// Should only show the recent run (after file mtime)
		expect(output).toContain("FAILED");
		expect(output).toContain("check:.:lint");
		// Should NOT show "All Runs in Session" since there's only 1 run in this session
		expect(output).not.toContain("All Runs in Session");
		// Should NOT contain the old runs from Feb 1
		expect(output).not.toContain("mode=verification");
	});

	it("should read log_dir from .gauntlet/config.yml", async () => {
		const customLogDir = path.join(TEST_DIR, "custom_logs");
		await fs.mkdir(customLogDir, { recursive: true });
		await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });

		const sessionTime = new Date("2026-02-07T10:00:00.000Z");

		await fs.writeFile(
			path.join(TEST_DIR, ".gauntlet", "config.yml"),
			"log_dir: custom_logs\n",
		);

		const debugLog = `[2026-02-07T10:00:00.000] RUN_START mode=full files_changed=1 gates=1
[2026-02-07T10:00:05.000] RUN_END status=pass fixed=0 skipped=0 failed=0 iterations=1 duration=5.0s
`;
		await fs.writeFile(path.join(customLogDir, ".debug.log"), debugLog);
		await writeFileAt(
			path.join(customLogDir, "console.1.log"),
			"test\n",
			sessionTime,
		);

		const output = runStatus(TEST_DIR);
		expect(output).toContain("Gauntlet Session Summary");
		expect(output).toContain("PASSED");
	});
});
