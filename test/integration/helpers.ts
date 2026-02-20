import path from "node:path";

export const GAUNTLET_ROOT = path.resolve(import.meta.dir, "../..");
export const DIST_BIN = path.join(GAUNTLET_ROOT, "dist", "index.js");

export async function isClaudeAvailable(): Promise<boolean> {
	const proc = Bun.spawn(["which", "claude"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return (await proc.exited) === 0;
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
