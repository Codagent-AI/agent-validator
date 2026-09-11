import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	REVIEWER_CLI_ENV,
	REVIEWER_EFFORT_ENV,
	REVIEWER_MODEL_ENV,
} from "../../src/config/reviewer-override.js";

const execFileAsync = promisify(execFile);
const VALIDATOR_ROOT = path.resolve(import.meta.dir, "../..");
const CLI = path.join(VALIDATOR_ROOT, "src/index.ts");
const TIMEOUT_MS = 30_000;

const MALFORMED_ENVS: { name: string; env: Record<string, string> }[] = [
	{ name: "model only", env: { [REVIEWER_MODEL_ENV]: "opus" } },
	{ name: "effort only", env: { [REVIEWER_EFFORT_ENV]: "high" } },
	{ name: "gemini CLI", env: { [REVIEWER_CLI_ENV]: "gemini" } },
	{
		name: "unknown effort",
		env: { [REVIEWER_CLI_ENV]: "claude", [REVIEWER_EFFORT_ENV]: "off" },
	},
	{ name: "Copilot wrong case", env: { [REVIEWER_CLI_ENV]: "Copilot" } },
];

const OVERLAY_COMMANDS: string[][] = [
	["run"],
	["review"],
	["health"],
	["list"],
	["detect"],
];

const tempDirs: string[] = [];

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd });
	return stdout.trim();
}

async function createRepo(): Promise<{ dir: string; configPath: string }> {
	const dir = await fs.mkdtemp(
		path.join(os.tmpdir(), "validator-reviewer-override-cmd-"),
	);
	tempDirs.push(dir);
	const configDir = path.join(dir, ".validator");
	await fs.mkdir(configDir, { recursive: true });
	const configPath = path.join(configDir, "config.yml");
	await fs.writeFile(
		configPath,
		`base_branch: base
log_dir: validator_logs
cli:
  default_preference:
    - codex
  adapters:
    codex:
      allow_tool_use: false
      thinking_budget: medium
entry_points:
  - path: "."
    checks:
      - echo-pass:
          command: "echo pass"
          timeout: 10
    reviews:
      - quality:
          builtin: code-quality
          cli_preference:
            - codex
`,
	);
	await fs.writeFile(path.join(dir, "app.ts"), "export const value = 1;\n");
	await fs.writeFile(path.join(dir, ".gitignore"), "validator_logs/\n");
	await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
	await git(["config", "user.email", "test@example.com"], dir);
	await git(["config", "user.name", "Test User"], dir);
	await git(["add", "."], dir);
	await git(["commit", "-m", "base"], dir);
	await git(["branch", "base"], dir);
	await fs.writeFile(path.join(dir, "app.ts"), "export const value = 2;\n");
	await git(["add", "app.ts"], dir);
	await git(["commit", "-m", "change"], dir);
	return { dir, configPath };
}

function spawnEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env[REVIEWER_CLI_ENV];
	delete env[REVIEWER_MODEL_ENV];
	delete env[REVIEWER_EFFORT_ENV];
	Object.assign(env, overrides);
	return env;
}

async function spawnCli(
	cwd: string,
	args: string[],
	overrides: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn([process.execPath, CLI, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: spawnEnv(overrides),
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

function combinedOutput(result: {
	stdout: string;
	stderr: string;
}): string {
	return `${result.stdout}\n${result.stderr}`;
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

describe("INT-003: overlay command selection and fail-closed wiring", () => {
	afterEach(async () => {
		for (const dir of tempDirs.splice(0)) {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	});

	it(
		"run, review, health, list, and detect fail closed on malformed reviewer env",
		async () => {
			const { dir } = await createRepo();
			for (const args of OVERLAY_COMMANDS) {
				for (const sample of MALFORMED_ENVS) {
					const result = await spawnCli(dir, args, sample.env);
					const output = combinedOutput(result);
					const label = `${args.join(" ")} / ${sample.name}`;
					expect(result.exitCode, label).not.toBe(0);
					expect(output, label).toMatch(/AGENT_VALIDATOR_REVIEWER_/);
					expect(output, label).not.toContain(
						"checking all supported agents",
					);
				}
			}
			expect(await pathExists(path.join(dir, "validator_logs"))).toBe(false);
		},
		TIMEOUT_MS,
	);

	it(
		"check ignores a malformed override and runs tracked checks",
		async () => {
			const { dir } = await createRepo();
			const result = await spawnCli(dir, ["check"], {
				[REVIEWER_MODEL_ENV]: "opus",
				[REVIEWER_CLI_ENV]: "gemini",
			});
			const output = combinedOutput(result);
			expect(output).not.toMatch(/AGENT_VALIDATOR_REVIEWER_/);
			expect(result.exitCode).toBe(0);
			expect(await pathExists(path.join(dir, "validator_logs"))).toBe(true);
		},
		TIMEOUT_MS,
	);

	it(
		"validate ignores a malformed override and validates the tracked file",
		async () => {
			const { dir } = await createRepo();
			const result = await spawnCli(dir, ["validate"], {
				[REVIEWER_MODEL_ENV]: "opus",
			});
			expect(combinedOutput(result)).not.toMatch(/AGENT_VALIDATOR_REVIEWER_/);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("valid");
		},
		TIMEOUT_MS,
	);

	it(
		"clean, skip, update-review, metrics, and CI listing ignore reviewer env",
		async () => {
			const { dir } = await createRepo();
			const malformed = { [REVIEWER_CLI_ENV]: "gemini" };

			const clean = await spawnCli(dir, ["clean"], malformed);
			expect(clean.exitCode).toBe(0);
			expect(combinedOutput(clean)).not.toMatch(/AGENT_VALIDATOR_REVIEWER_/);

			const skip = await spawnCli(dir, ["skip"], malformed);
			expect(skip.exitCode).toBe(0);
			expect(combinedOutput(skip)).not.toMatch(/AGENT_VALIDATOR_REVIEWER_/);

			const updateReview = await spawnCli(
				dir,
				["update-review", "list"],
				malformed,
			);
			expect(combinedOutput(updateReview)).not.toMatch(
				/AGENT_VALIDATOR_REVIEWER_/,
			);

			const metrics = await spawnCli(
				dir,
				["metrics", "capabilities"],
				malformed,
			);
			expect(metrics.exitCode).toBe(0);
			expect(combinedOutput(metrics)).not.toMatch(/AGENT_VALIDATOR_REVIEWER_/);

			const ci = await spawnCli(dir, ["ci", "list-jobs"], malformed);
			expect(combinedOutput(ci)).not.toMatch(/AGENT_VALIDATOR_REVIEWER_/);
			expect(combinedOutput(ci)).toMatch(/CI configuration file not found/);
		},
		TIMEOUT_MS,
	);

	it(
		"list overlays the mapped adapter and does not rewrite tracked config",
		async () => {
			const { dir, configPath } = await createRepo();
			const before = await fs.readFile(configPath, "utf-8");
			const result = await spawnCli(dir, ["list"], {
				[REVIEWER_CLI_ENV]: "claude",
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("claude");
			expect(result.stdout).not.toContain("codex");
			expect(await fs.readFile(configPath, "utf-8")).toBe(before);
		},
		TIMEOUT_MS,
	);

	it(
		"successful overlay run leaves tracked config unchanged",
		async () => {
			const { dir, configPath } = await createRepo();
			const before = await fs.readFile(configPath, "utf-8");
			const result = await spawnCli(dir, ["run", "--gate", "echo-pass"], {
				[REVIEWER_CLI_ENV]: "claude",
			});
			expect(result.exitCode).toBe(0);
			expect(await fs.readFile(configPath, "utf-8")).toBe(before);
		},
		TIMEOUT_MS,
	);

	it(
		"list keeps its prior exit code for config errors unrelated to the override",
		async () => {
			const { dir, configPath } = await createRepo();
			await fs.writeFile(configPath, "base_branch: [not-a-string]\n");

			const result = await spawnCli(dir, ["list"]);

			// Only a ReviewerOverrideError makes `list` fail closed. Other load
			// failures keep the exit code they had before the override shipped.
			expect(result.exitCode).toBe(0);
			expect(combinedOutput(result)).toContain("Error:");
		},
		TIMEOUT_MS,
	);
});
