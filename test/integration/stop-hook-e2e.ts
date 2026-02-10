#!/usr/bin/env bun
/**
 * Stop Hook E2E Integration Test (Coordinator Model)
 *
 * Tests the stop hook's state-reading coordinator behavior:
 *
 * Phase 1: Block with pre-seeded failed logs
 * 1. Create temp project with gauntlet config + failed gate logs
 * 2. Claude runs a task and tries to stop
 * 3. Stop hook finds failed logs, blocks with validation_required
 *
 * Phase 2: Allow with clean state
 * 4. Remove failed logs (simulating agent fixing issues)
 * 5. Claude runs again and tries to stop
 * 6. Stop hook finds no failed logs and no changes, allows stop
 *
 * Verified via gauntlet_logs/.debug.log
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const GAUNTLET_ROOT = path.resolve(import.meta.dir, "../..");
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Preflight ───────────────────────────────────────────────

async function preflight(): Promise<void> {
	const proc = Bun.spawn(["which", "claude"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		console.error("[FATAL] `claude` CLI not found on PATH. Install it first.");
		process.exit(1);
	}
}

// ─── Project Setup ───────────────────────────────────────────

async function writeProjectConfigs(tempDir: string): Promise<void> {
	await fs.writeFile(
		path.join(tempDir, ".gauntlet", "config.yml"),
		`base_branch: main
log_dir: gauntlet_logs
debug_log:
  enabled: true
  max_size_mb: 10
stop_hook:
  enabled: true
  run_interval_minutes: 0
  auto_push_pr: false
cli:
  default_preference:
    - claude
entry_points:
  - path: "src"
    checks:
      - no-var
`,
	);

	await fs.writeFile(
		path.join(tempDir, ".gauntlet", "checks", "no-var.yml"),
		`command: "! grep -rn '\\\\bvar\\\\b' . --include='*.ts'"
timeout: 30
`,
	);

	const hookCommand = `bun ${GAUNTLET_ROOT}/src/index.ts stop-hook`;
	await fs.writeFile(
		path.join(tempDir, ".claude", "settings.local.json"),
		JSON.stringify(
			{
				hooks: {
					Stop: [
						{
							hooks: [
								{
									type: "command",
									command: hookCommand,
									timeout: 300,
								},
							],
						},
					],
				},
			},
			null,
			2,
		),
	);
}

async function initGitRepo(dir: string): Promise<void> {
	const gitInit = Bun.spawn(
		[
			"bash",
			"-c",
			[
				"git init",
				"git checkout -b main",
				'git config user.email "test@test.com"',
				'git config user.name "Test"',
				"git add -A",
				'git commit -m "initial project setup"',
			].join(" && "),
		],
		{ cwd: dir, stdout: "pipe", stderr: "pipe" },
	);
	const exitCode = await gitInit.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(gitInit.stderr).text();
		throw new Error(`Git setup failed: ${stderr}`);
	}
}

/**
 * Seed the log directory with a failed gate log file.
 * This simulates a prior failed gauntlet run that hasn't been archived.
 */
async function seedFailedLogs(tempDir: string): Promise<void> {
	const logDir = path.join(tempDir, "gauntlet_logs");
	await fs.mkdir(logDir, { recursive: true });
	await fs.writeFile(
		path.join(logDir, "check_src_no-var.1.log"),
		"src/helpers.ts:3:  var result = first + ' ' + last;\nFailed: found var usage",
	);
}

/**
 * Check if a filename is a gate log (not a dot-file or console log).
 */
function isGateLog(filename: string): boolean {
	return (
		(filename.endsWith(".log") || filename.endsWith(".json")) &&
		!filename.startsWith(".") &&
		!filename.startsWith("console.")
	);
}

/**
 * Remove failed gate logs (simulating the agent fixing issues via gauntlet-run).
 */
async function clearFailedLogs(tempDir: string): Promise<void> {
	const logDir = path.join(tempDir, "gauntlet_logs");
	const entries = await fs.readdir(logDir);
	const gateLogs = entries.filter(isGateLog);
	await Promise.all(gateLogs.map((f) => fs.rm(path.join(logDir, f))));
}

async function setupProject(): Promise<string> {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gauntlet-e2e-"));

	await fs.mkdir(path.join(tempDir, ".gauntlet", "checks"), {
		recursive: true,
	});
	await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });
	await fs.mkdir(path.join(tempDir, "src"), { recursive: true });

	await writeProjectConfigs(tempDir);
	await initGitRepo(tempDir);

	return tempDir;
}

// ─── Run Claude ──────────────────────────────────────────────

async function runClaude(
	tempDir: string,
	prompt: string,
	label: string,
): Promise<void> {
	const env = { ...process.env };
	delete env.GAUNTLET_STOP_HOOK_ACTIVE;
	delete env.GAUNTLET_STOP_HOOK_ENABLED;

	console.log(`\n--- ${label} ---`);
	const proc = Bun.spawn(["claude", "-p", prompt], {
		cwd: tempDir,
		stdout: "pipe",
		stderr: "pipe",
		env,
	});

	const timeout = setTimeout(() => {
		console.error("[TIMEOUT] Claude did not finish within 5 minutes. Killing.");
		proc.kill();
	}, TIMEOUT_MS);

	try {
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		if (stdout.trim()) {
			console.log(stdout.slice(0, 2000));
		}
		if (stderr.trim()) {
			console.log("stderr:", stderr.slice(0, 1000));
		}

		console.log(`Exit code: ${exitCode}`);
	} finally {
		clearTimeout(timeout);
	}
}

// ─── Verify Logs ─────────────────────────────────────────────

interface Assertion {
	label: string;
	passed: boolean;
}

async function verifyLogs(tempDir: string): Promise<Assertion[]> {
	const debugLogPath = path.join(tempDir, "gauntlet_logs", ".debug.log");
	const assertions: Assertion[] = [];

	let logContent: string;
	try {
		logContent = await fs.readFile(debugLogPath, "utf-8");
	} catch {
		console.error(`[ERROR] Debug log not found at ${debugLogPath}`);
		return [
			{ label: "Debug log exists", passed: false },
			{ label: "Stop hook ran", passed: false },
			{ label: "Blocked with validation_required", passed: false },
			{ label: "Allowed after cleanup", passed: false },
		];
	}

	assertions.push({ label: "Debug log exists", passed: true });

	const lines = logContent.split("\n").filter((l) => l.trim());

	// Assertion 1: Stop hook ran at least once
	const stopHookRan = lines.some((l) => l.includes("COMMAND stop-hook"));
	assertions.push({ label: "Stop hook ran", passed: stopHookRan });

	// Assertion 2: Stop hook blocked with validation_required (failed logs detected)
	const stopHookLines = lines.filter((l) => l.includes("STOP_HOOK decision="));
	const blockedWithValidation = stopHookLines.some(
		(l) => l.includes("decision=block") && l.includes("validation_required"),
	);
	assertions.push({
		label: "Blocked with validation_required",
		passed: blockedWithValidation,
	});

	// Assertion 3: Stop hook later allowed (after failed logs were cleaned)
	const blockIndex = stopHookLines.findIndex((l) =>
		l.includes("decision=block"),
	);
	const allowIndex = stopHookLines.findIndex(
		(l, i) => i > blockIndex && l.includes("decision=allow"),
	);
	const allowedAfterCleanup = blockIndex !== -1 && allowIndex !== -1;
	assertions.push({
		label: "Allowed after cleanup",
		passed: allowedAfterCleanup,
	});

	return assertions;
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("=== Stop Hook E2E Integration Test (Coordinator Model) ===\n");

	await preflight();
	console.log("[OK] claude CLI found on PATH");

	let tempDir: string | undefined;
	try {
		tempDir = await setupProject();
		console.log(`[OK] Temp project created at ${tempDir}`);

		// Phase 1: Seed failed logs so the stop hook blocks
		await seedFailedLogs(tempDir);
		console.log("[OK] Seeded failed gate logs");

		await runClaude(
			tempDir,
			"Create a file at src/helpers.ts with an exported function formatName(first: string, last: string): string that concatenates first and last name with a space.",
			"Phase 1: Claude run with failed logs (expect block)",
		);

		// Phase 2: Clear failed logs so the stop hook allows
		await clearFailedLogs(tempDir);
		console.log("\n[OK] Cleared failed gate logs");

		await runClaude(
			tempDir,
			"Read src/helpers.ts and tell me what functions it exports.",
			"Phase 2: Claude run with clean state (expect allow)",
		);

		console.log("\n=== Assertions ===\n");
		const assertions = await verifyLogs(tempDir);

		let allPassed = true;
		for (const a of assertions) {
			const status = a.passed ? "[PASS]" : "[FAIL]";
			console.log(`${status} ${a.label}`);
			if (!a.passed) allPassed = false;
		}

		if (!allPassed) {
			console.log("\n=== Debug Log Dump ===\n");
			try {
				const logPath = path.join(tempDir, "gauntlet_logs", ".debug.log");
				const log = await fs.readFile(logPath, "utf-8");
				console.log(log);
			} catch {
				console.log("(debug log not available)");
			}
			throw new Error("Some assertions failed");
		}

		console.log("\n[SUCCESS] All assertions passed.");
	} finally {
		if (tempDir) {
			try {
				await fs.rm(tempDir, { recursive: true, force: true });
				console.log(`[CLEANUP] Removed ${tempDir}`);
			} catch {
				console.error(`[WARN] Failed to clean up ${tempDir}`);
			}
		}
	}
}

main().catch((err) => {
	console.error("[FATAL]", err);
	process.exit(1);
});
