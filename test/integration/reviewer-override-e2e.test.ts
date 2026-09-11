import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	DIST_BIN,
	initGitRepo,
	isDistBuilt,
	spawnValidator,
} from "./helpers.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 60_000;
const MODEL_ENV = "AGENT_VALIDATOR_REVIEWER_MODEL";
const CLI_ENV = "AGENT_VALIDATOR_REVIEWER_CLI";
const EFFORT_ENV = "AGENT_VALIDATOR_REVIEWER_EFFORT";

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

const tempDirs: string[] = [];

describe("E2E-002: fail-closed leaves no trace and does not touch check", () => {
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
});
