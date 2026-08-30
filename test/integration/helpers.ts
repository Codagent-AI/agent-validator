import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VALIDATOR_ROOT = path.resolve(import.meta.dir, "../..");
export const DIST_BIN = path.join(VALIDATOR_ROOT, "dist", "index.js");

export function isDistBuilt(): boolean {
	return fs.existsSync(DIST_BIN);
}

export async function createClaudeStub(): Promise<{
	binDir: string;
	cleanup: () => Promise<void>;
}> {
	const binDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "claude-stub-"),
	);
	const claudePath = path.join(binDir, "claude");
	await fs.promises.writeFile(claudePath, "#!/bin/sh\necho '[]'\nexit 0\n");
	await fs.promises.chmod(claudePath, 0o755);

	// Stub `copilot` so that `copilot --help` (used by the github-copilot
	// adapter's isAvailable check) exits immediately instead of hanging in CI.
	const copilotPath = path.join(binDir, "copilot");
	await fs.promises.writeFile(copilotPath, "#!/bin/sh\nexit 1\n");
	await fs.promises.chmod(copilotPath, 0o755);

	return {
		binDir,
		cleanup: () =>
			fs.promises.rm(binDir, { recursive: true, force: true }),
	};
}

export interface RecordingCodexStub {
	binDir: string;
	captureDir: string;
	modeFile: string;
	setMode: (mode: "pass" | "process-error" | "review-fail") => Promise<void>;
	readCaptures: () => Promise<string[]>;
	cleanup: () => Promise<void>;
}

export async function createRecordingCodexStub(): Promise<RecordingCodexStub> {
	const rootDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "codex-recording-stub-"),
	);
	const binDir = path.join(rootDir, "bin");
	const captureDir = path.join(rootDir, "captures");
	const modeFile = path.join(rootDir, "mode");
	await fs.promises.mkdir(binDir);
	await fs.promises.mkdir(captureDir);
	await fs.promises.writeFile(modeFile, "pass\n");

	const codexPath = path.join(binDir, "codex");
	await fs.promises.writeFile(
		codexPath,
		`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const captureDir = process.env.FAKE_CODEX_CAPTURE_DIR;
const modeFile = process.env.FAKE_CODEX_MODE_FILE;
const input = fs.readFileSync(0, "utf8");
const captureNumber = fs.readdirSync(captureDir).filter((file) => file.startsWith("input-")).length + 1;
fs.writeFileSync(path.join(captureDir, \`input-\${captureNumber}.txt\`), input);
const mode = fs.readFileSync(modeFile, "utf8").trim();
if (mode === "process-error") {
  process.stderr.write("simulated adapter failure\\n");
  process.exit(17);
}
const result = mode === "review-fail"
  ? { status: "fail", violations: [{ file: "task.ts", line: 2, issue: "Acceptance finding", priority: "high", status: "new" }] }
  : { status: "pass", message: "Recording adapter pass" };
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(result) } }) + "\\n");
`,
	);
	await fs.promises.chmod(codexPath, 0o755);

	return {
		binDir,
		captureDir,
		modeFile,
		setMode: (mode) => fs.promises.writeFile(modeFile, `${mode}\n`),
		readCaptures: async () => {
			const files = (await fs.promises.readdir(captureDir)).sort((a, b) =>
				a.localeCompare(b, undefined, { numeric: true }),
			);
			return Promise.all(
				files.map((file) =>
					fs.promises.readFile(path.join(captureDir, file), "utf8"),
				),
			);
		},
		cleanup: () => fs.promises.rm(rootDir, { recursive: true, force: true }),
	};
}

export async function initGitRepo(dir: string): Promise<void> {
	const proc = Bun.spawn(
		[
			"bash",
			"-c",
			[
				"git init",
				"git checkout -b main",
				'git config user.email "test@test.com"',
				'git config user.name "Test"',
				"git add -A",
				'git commit -m "initial"',
			].join(" && "),
		],
		{ cwd: dir, stdout: "pipe", stderr: "pipe" },
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Git setup failed: ${stderr}`);
	}
}

export async function spawnValidator(
	args: string[],
	opts: {
		cwd: string;
		env?: Record<string, string | undefined>;
		timeoutMs?: number;
	},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn([process.execPath, DIST_BIN, ...args], {
		cwd: opts.cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: opts.env ?? process.env,
	});

	const timeoutMs = opts.timeoutMs ?? 30_000;
	const timer = setTimeout(() => proc.kill(), timeoutMs);

	try {
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}
