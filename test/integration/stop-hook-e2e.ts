#!/usr/bin/env bun
/**
 * Stop Hook E2E Integration Test
 *
 * Exercises the full stop-hook lifecycle:
 * 1. Claude creates a file with intentional lint errors (var, console.log)
 * 2. Stop hook fires, detects check failures, blocks Claude
 * 3. Claude fixes errors, stop hook re-runs, passes
 * 4. Script verifies the flow via gauntlet_logs/.debug.log
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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
      - no-console-log
`,
	);

	// Note: working directory is the entry point path (src/), so grep searches "."
	await fs.writeFile(
		path.join(tempDir, ".gauntlet", "checks", "no-var.yml"),
		`command: "! grep -rn '\\\\bvar\\\\b' . --include='*.ts'"
timeout: 30
`,
	);
	await fs.writeFile(
		path.join(tempDir, ".gauntlet", "checks", "no-console-log.yml"),
		`command: "! grep -rn 'console\\\\.log' . --include='*.ts'"
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

async function runClaude(tempDir: string): Promise<void> {
	const prompt = `Create a file at src/helpers.ts with the following exported functions:

1. formatName(first: string, last: string): string — concatenates first and last name
   with a space. Log the result with console.log before returning. Use var for
   local variable declarations.

2. sum(numbers: number[]): number — returns the sum using reduce. Use var for the
   accumulator variable.

Important: You MUST use 'var' for all variable declarations and include console.log
calls exactly as described. Do not use const or let. Do not remove console.log.`;

	const env = { ...process.env };
	delete env.GAUNTLET_STOP_HOOK_ACTIVE;
	delete env.GAUNTLET_STOP_HOOK_ENABLED;

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
			console.log("\n--- Claude stdout ---");
			console.log(stdout.slice(0, 2000));
		}
		if (stderr.trim()) {
			console.log("\n--- Claude stderr ---");
			console.log(stderr.slice(0, 2000));
		}

		console.log(`\nClaude exited with code ${exitCode}`);
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
			{ label: "Validation suite ran", passed: false },
			{ label: "Errors detected", passed: false },
			{ label: "Second iteration ran", passed: false },
			{ label: "Eventually passed", passed: false },
		];
	}

	assertions.push({ label: "Debug log exists", passed: true });

	const lines = logContent.split("\n").filter((l) => l.trim());

	// Assertion 1: Stop hook ran
	const stopHookRan = lines.some((l) => l.includes("COMMAND stop-hook"));
	assertions.push({ label: "Stop hook ran", passed: stopHookRan });

	// Assertion 2: Validation suite ran
	const runStartLines = lines.filter((l) => l.includes("RUN_START"));
	assertions.push({
		label: "Validation suite ran",
		passed: runStartLines.length > 0,
	});

	// Assertion 3: Errors detected
	const gateFailLines = lines.filter(
		(l) => l.includes("GATE_RESULT") && l.includes("status=fail"),
	);
	assertions.push({
		label: "Errors detected",
		passed: gateFailLines.length > 0,
	});

	// Assertion 4: Second iteration ran
	// Check for 2+ RUN_START lines OR iterations=2+ in RUN_END
	const runEndLines = lines.filter((l) => l.includes("RUN_END"));
	const hasMultipleRunStarts = runStartLines.length >= 2;
	const hasMultipleIterations = runEndLines.some((l) => {
		const match = l.match(/iterations=(\d+)/);
		return match ? Number.parseInt(match[1], 10) >= 2 : false;
	});
	assertions.push({
		label: "Second iteration ran",
		passed: hasMultipleRunStarts || hasMultipleIterations,
	});

	// Assertion 5: Eventually passed (decision=allow after a decision=block)
	const stopHookLines = lines.filter((l) => l.includes("STOP_HOOK decision="));
	const blockIndex = stopHookLines.findIndex((l) =>
		l.includes("decision=block"),
	);
	const allowIndex = stopHookLines.findIndex((l) =>
		l.includes("decision=allow"),
	);
	const eventuallyPassed =
		blockIndex !== -1 && allowIndex !== -1 && allowIndex > blockIndex;
	assertions.push({ label: "Eventually passed", passed: eventuallyPassed });

	return assertions;
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("=== Stop Hook E2E Integration Test ===\n");

	await preflight();
	console.log("[OK] claude CLI found on PATH");

	let tempDir: string | undefined;
	try {
		tempDir = await setupProject();
		console.log(`[OK] Temp project created at ${tempDir}\n`);

		await runClaude(tempDir);

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
