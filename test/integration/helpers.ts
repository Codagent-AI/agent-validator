import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GAUNTLET_ROOT = path.resolve(import.meta.dir, "../..");
export const DIST_BIN = path.join(GAUNTLET_ROOT, "dist", "index.js");

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
	return {
		binDir,
		cleanup: () =>
			fs.promises.rm(binDir, { recursive: true, force: true }),
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

export async function spawnGauntlet(
	args: string[],
	opts: {
		cwd: string;
		env?: Record<string, string | undefined>;
		timeoutMs?: number;
	},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["node", DIST_BIN, ...args], {
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
