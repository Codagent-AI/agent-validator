import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	GAUNTLET_ROOT,
	initGitRepo,
	isClaudeAvailable,
	isDistBuilt,
} from "./helpers.js";

const TIMEOUT_MS = 5 * 60 * 1000;

let tempDir: string;
let canRun: boolean;

async function writeProjectConfigs(dir: string): Promise<void> {
	await fs.writeFile(
		path.join(dir, ".gauntlet", "config.yml"),
		`base_branch: main
log_dir: gauntlet_logs
debug_log:
  enabled: true
  max_size_mb: 10
stop_hook:
  enabled: true
  run_interval_minutes: 0
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
		path.join(dir, ".gauntlet", "checks", "no-var.yml"),
		`command: "! grep -rn '\\\\bvar\\\\b' . --include='*.ts'"
timeout: 30
`,
	);

	const hookCommand = `node ${GAUNTLET_ROOT}/dist/index.js stop-hook`;
	await fs.writeFile(
		path.join(dir, ".claude", "settings.local.json"),
		JSON.stringify(
			{
				hooks: {
					Stop: [
						{
							hooks: [
								{ type: "command", command: hookCommand, timeout: 300 },
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

function isGateLog(filename: string): boolean {
	return (
		(filename.endsWith(".log") || filename.endsWith(".json")) &&
		!filename.startsWith(".") &&
		!filename.startsWith("console.")
	);
}

async function runClaude(
	dir: string,
	prompt: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const env = { ...process.env };
	delete env.GAUNTLET_STOP_HOOK_ACTIVE;
	delete env.GAUNTLET_STOP_HOOK_ENABLED;
	delete env.CLAUDECODE;

	const proc = Bun.spawn(["claude", "-p", prompt], {
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
		env,
	});

	const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
	try {
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

beforeAll(async () => {
	canRun = isDistBuilt() && (await isClaudeAvailable());
	if (!canRun) return;

	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gauntlet-e2e-"));
	await fs.mkdir(path.join(tempDir, ".gauntlet", "checks"), {
		recursive: true,
	});
	await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });
	await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
	await writeProjectConfigs(tempDir);
	await initGitRepo(tempDir);
});

afterAll(async () => {
	if (tempDir) {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("stop-hook E2E (coordinator model)", () => {
	it(
		"should block when failed logs exist, then allow after cleanup",
		async () => {
			if (!canRun) return;

			// Phase 1: Seed failed logs, run claude — expect block
			const logDir = path.join(tempDir, "gauntlet_logs");
			await fs.mkdir(logDir, { recursive: true });
			await fs.writeFile(
				path.join(logDir, "check_src_no-var.1.log"),
				"src/helpers.ts:3:  var result = first + ' ' + last;\nFailed: found var usage",
			);

			await runClaude(
				tempDir,
				"Create a file at src/helpers.ts with an exported function formatName(first: string, last: string): string that concatenates first and last name with a space.",
			);

			// Phase 2: Clear failed logs, run claude — expect allow
			const entries = await fs.readdir(logDir);
			const gateLogs = entries.filter(isGateLog);
			await Promise.all(
				gateLogs.map((f) => fs.rm(path.join(logDir, f))),
			);

			await runClaude(
				tempDir,
				"Read src/helpers.ts and tell me what functions it exports.",
			);

			// Verify debug log
			const debugLog = await fs.readFile(
				path.join(logDir, ".debug.log"),
				"utf-8",
			);
			const lines = debugLog.split("\n").filter((l) => l.trim());

			expect(lines.some((l) => l.includes("COMMAND stop-hook"))).toBe(
				true,
			);

			const stopLines = lines.filter((l) =>
				l.includes("STOP_HOOK decision="),
			);
			expect(
				stopLines.some(
					(l) =>
						l.includes("decision=block") &&
						l.includes("validation_required"),
				),
			).toBe(true);

			const blockIdx = stopLines.findIndex((l) =>
				l.includes("decision=block"),
			);
			const allowIdx = stopLines.findIndex(
				(l, i) => i > blockIdx && l.includes("decision=allow"),
			);
			expect(blockIdx).not.toBe(-1);
			expect(allowIdx).not.toBe(-1);
		},
		{ timeout: TIMEOUT_MS * 2 + 30_000 },
	);
});
