import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	REVIEWER_CLI_ENV as CLI_ENV,
	REVIEWER_EFFORT_ENV as EFFORT_ENV,
	REVIEWER_MODEL_ENV as MODEL_ENV,
} from "../../src/config/reviewer-override.js";
import {
	createReviewerOverrideStubs,
	initGitRepo,
	isDistBuilt,
	type ReviewerOverrideStubs,
	spawnValidator,
} from "./helpers.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 60_000;

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd });
	return stdout.trim();
}

async function writeProject(dir: string): Promise<string> {
	const configPath = path.join(dir, ".validator", "config.yml");
	await fs.mkdir(path.join(dir, ".validator"), { recursive: true });
	await fs.writeFile(
		configPath,
		`base_branch: base
log_dir: validator_logs
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - echo-pass:
          command: "echo pass"
          timeout: 10
    reviews:
      - quality:
          builtin: code-quality
`,
	);
	await fs.writeFile(path.join(dir, "app.ts"), "export const value = 1;\n");
	await fs.writeFile(path.join(dir, ".gitignore"), "validator_logs/\n");
	return configPath;
}

async function createRepo(): Promise<{ dir: string; configPath: string }> {
	const dir = await fs.mkdtemp(
		path.join(os.tmpdir(), "validator-reviewer-override-e2e-"),
	);
	const configPath = await writeProject(dir);
	await initGitRepo(dir);
	await git(["branch", "base"], dir);
	await fs.writeFile(path.join(dir, "app.ts"), "export const value = 2;\n");
	await git(["add", "app.ts"], dir);
	await git(["commit", "-m", "change"], dir);
	return { dir, configPath };
}

function overrideEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env[CLI_ENV];
	delete env[MODEL_ENV];
	delete env[EFFORT_ENV];
	Object.assign(env, overrides);
	return env;
}

async function exists(target: string): Promise<boolean> {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

function stubEnv(
	stubs: ReviewerOverrideStubs,
	overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
	const env = overrideEnv(overrides);
	env.CI = undefined;
	env.GITHUB_ACTIONS = undefined;
	env.GITHUB_BASE_REF = undefined;
	env.GITHUB_SHA = undefined;
	env.PATH = `${stubs.binDir}:${process.env.PATH ?? ""}`;
	env.FAKE_COPILOT_CAPTURE_DIR = stubs.copilotCaptureDir;
	env.FAKE_CLAUDE_CAPTURE_FILE = stubs.claudeCaptureFile;
	return env;
}

const IDENTITY_LINE =
	"Reviewer: github-copilot (runner-reviewer-role; effort xhigh→high)";

describe("E2E-001: Override reaches the reviewer subprocess", () => {
	const dirs: string[] = [];
	const stubs: ReviewerOverrideStubs[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
		await Promise.all(stubs.splice(0).map((stub) => stub.cleanup()));
	});

	it(
		"dispatches the mapped adapter, names the identity, and leaves tracked config unchanged",
		async () => {
			if (!isDistBuilt()) return;

			const { dir, configPath } = await createRepo();
			dirs.push(dir);
			const stub = await createReviewerOverrideStubs();
			stubs.push(stub);
			const before = await fs.readFile(configPath, "utf-8");
			const env = stubEnv(stub, {
				[CLI_ENV]: "copilot",
				[MODEL_ENV]: "gpt-5",
				[EFFORT_ENV]: "xhigh",
			});

			const result = await spawnValidator(["run", "--report"], {
				cwd: dir,
				env,
				timeoutMs: TIMEOUT_MS,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain(IDENTITY_LINE);
			expect(result.stdout).toContain("Status: Passed");
			expect(result.stdout).toContain(IDENTITY_LINE);

			const copilotArgv = await stub.readCopilotArgv();
			expect(copilotArgv.length).toBeGreaterThan(0);
			const args = copilotArgv[0] ?? [];
			expect(args).toContain("--model");
			expect(args[args.indexOf("--model") + 1]).toBe("gpt-5");
			expect(args).toContain("--effort");
			expect(args[args.indexOf("--effort") + 1]).toBe("high");
			const allowedTools = args.flatMap((arg, index) =>
				arg === "--allow-tool" ? [args[index + 1]] : [],
			);
			expect(allowedTools).toEqual(["shell(cat)"]);
			expect(await stub.readClaudeInvocations()).toBe("");
			expect(await fs.readFile(configPath, "utf-8")).toBe(before);
		},
		TIMEOUT_MS,
	);

	it(
		"names the identity on stderr but leaves stdout unchanged without --report",
		async () => {
			if (!isDistBuilt()) return;

			// A fresh repo: reusing the repo above would trust HEAD and
			// short-circuit before any RESULTS SUMMARY is printed.
			const { dir } = await createRepo();
			dirs.push(dir);
			const stub = await createReviewerOverrideStubs();
			stubs.push(stub);
			const env = stubEnv(stub, {
				[CLI_ENV]: "copilot",
				[MODEL_ENV]: "gpt-5",
				[EFFORT_ENV]: "xhigh",
			});

			const result = await spawnValidator(["run"], {
				cwd: dir,
				env,
				timeoutMs: TIMEOUT_MS,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain(IDENTITY_LINE);
			expect(result.stdout).not.toContain("Reviewer:");
			expect(result.stdout).not.toContain("Status:");
		},
		TIMEOUT_MS,
	);
});

describe("E2E-003: Trusted short-circuit still names the identity", () => {
	const dirs: string[] = [];
	const stubs: ReviewerOverrideStubs[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
		await Promise.all(stubs.splice(0).map((stub) => stub.cleanup()));
	});

	it(
		"names the configured identity on a trusted --report rerun without dispatching",
		async () => {
			if (!isDistBuilt()) return;

			const { dir } = await createRepo();
			dirs.push(dir);
			const stub = await createReviewerOverrideStubs();
			stubs.push(stub);
			const baselineEnv = stubEnv(stub);

			const first = await spawnValidator(["run", "--report"], {
				cwd: dir,
				env: baselineEnv,
				timeoutMs: TIMEOUT_MS,
			});
			expect(first.exitCode).toBe(0);
			expect(first.stdout).toContain("Status: Passed");
			expect(first.stdout).not.toContain("Reviewer:");
			expect(first.stderr).not.toContain("runner-reviewer-role");
			expect(await stub.readClaudeInvocations()).not.toBe("");

			const overrideEnvVars = stubEnv(stub, {
				[CLI_ENV]: "copilot",
				[MODEL_ENV]: "gpt-5",
				[EFFORT_ENV]: "xhigh",
			});
			const trustedWithOverride = await spawnValidator(["run", "--report"], {
				cwd: dir,
				env: overrideEnvVars,
				timeoutMs: TIMEOUT_MS,
			});
			expect(trustedWithOverride.exitCode).toBe(0);
			expect(trustedWithOverride.stdout).toContain("Status: Trusted");
			expect(trustedWithOverride.stdout).toContain(IDENTITY_LINE);
			expect(trustedWithOverride.stderr).not.toContain("RESULTS SUMMARY");
			expect(await stub.readCopilotArgv()).toEqual([]);

			const trustedWithoutOverride = await spawnValidator(["run", "--report"], {
				cwd: dir,
				env: baselineEnv,
				timeoutMs: TIMEOUT_MS,
			});
			expect(trustedWithoutOverride.exitCode).toBe(0);
			expect(trustedWithoutOverride.stdout).toBe("Status: Trusted\n");
			expect(trustedWithoutOverride.stderr).not.toContain("RESULTS SUMMARY");
		},
		TIMEOUT_MS,
	);
});

describe("E2E-002: fail-closed leaves no trace and does not touch check", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		for (const dir of tempDirs.splice(0)) {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	});

	it(
		"run fails closed on model-only env while check still runs",
		async () => {
			if (!isDistBuilt()) return;

			const { dir, configPath } = await createRepo();
			tempDirs.push(dir);
			const before = await fs.readFile(configPath, "utf-8");
			const env = overrideEnv({ [MODEL_ENV]: "opus" });

			const runResult = await spawnValidator(["run"], {
				cwd: dir,
				env,
				timeoutMs: TIMEOUT_MS,
			});
			const runOutput = `${runResult.stdout}\n${runResult.stderr}`;
			expect(runResult.exitCode).not.toBe(0);
			expect(runOutput).toContain(CLI_ENV);
			expect(await exists(path.join(dir, "validator_logs"))).toBe(false);
			expect(
				await exists(path.join(dir, "validator_logs", ".validator-run.lock")),
			).toBe(false);

			const checkResult = await spawnValidator(["check"], {
				cwd: dir,
				env,
				timeoutMs: TIMEOUT_MS,
			});
			expect(checkResult.exitCode).toBe(0);
			expect(`${checkResult.stdout}\n${checkResult.stderr}`).not.toContain(
				CLI_ENV,
			);
			expect(await fs.readFile(configPath, "utf-8")).toBe(before);
		},
		TIMEOUT_MS,
	);

	it(
		"names the rejected variable in the report when --report is passed",
		async () => {
			if (!isDistBuilt()) return;

			const { dir } = await createRepo();
			tempDirs.push(dir);
			const env = overrideEnv({ [MODEL_ENV]: "opus" });

			const result = await spawnValidator(["run", "--report"], {
				cwd: dir,
				env,
				timeoutMs: TIMEOUT_MS,
			});

			// The report must be self-contained, so an orchestrator reading only
			// stdout can tell a rejected reviewer role from any other failure.
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toContain("Status: error");
			expect(result.stdout).toContain(CLI_ENV);
		},
		TIMEOUT_MS,
	);
});
