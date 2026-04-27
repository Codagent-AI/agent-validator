import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VALIDATOR_ROOT = path.resolve(import.meta.dir, "../..");

const tempDirs: string[] = [];

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd });
	return stdout.trim();
}

async function createRepo(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-detect-"));
	tempDirs.push(dir);
	await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
	await execFileAsync("git", ["config", "user.email", "test@example.com"], {
		cwd: dir,
	});
	await execFileAsync("git", ["config", "user.name", "Test User"], {
		cwd: dir,
	});
	await fs.mkdir(path.join(dir, ".validator"), { recursive: true });
	await fs.mkdir(path.join(dir, ".validator", "checks"), { recursive: true });
	await fs.writeFile(
		path.join(dir, ".validator", "config.yml"),
		`base_branch: base
log_dir: validator_logs
cli:
  default_preference:
    - codex
entry_points:
  - path: "."
    checks:
      - unit
checks:
`,
		"utf-8",
	);
	await fs.writeFile(
		path.join(dir, ".validator", "checks", "unit.yml"),
		`command: "true"\n`,
		"utf-8",
	);
	await fs.writeFile(path.join(dir, "app.ts"), "export const value = 1;\n");
	await fs.writeFile(path.join(dir, ".gitignore"), "validator_logs/\n");
	await git(["add", "."], dir);
	await git(["commit", "-m", "base"], dir);
	await git(["branch", "base"], dir);
	await fs.writeFile(path.join(dir, "app.ts"), "export const value = 2;\n");
	await git(["add", "app.ts"], dir);
	await git(["commit", "-m", "trusted change"], dir);
	return dir;
}

async function appendTrustedRecord(dir: string, ref: string): Promise<void> {
	const [commonDir, commit, tree] = await Promise.all([
		git(["rev-parse", "--git-common-dir"], dir),
		git(["rev-parse", ref], dir),
		git(["rev-parse", `${ref}^{tree}`], dir),
	]);
	const ledgerDir = path.resolve(dir, commonDir, "agent-validator");
	await fs.mkdir(ledgerDir, { recursive: true });
	await fs.appendFile(
		path.join(ledgerDir, "trusted-snapshots.jsonl"),
		`${JSON.stringify({
			commit,
			tree,
			config_hash: "config",
			scope: {
				command: "skip",
				gates: [],
				entry_points: ["."],
				cli_overrides: {},
			},
			scope_hash: "scope",
			validator_version: "1.10.0",
			source: "manual-skip",
			status: "skipped",
			trusted: true,
			created_at: "2026-01-01T00:00:00.000Z",
		})}\n`,
		"utf-8",
	);
}

async function trustHead(dir: string): Promise<void> {
	await appendTrustedRecord(dir, "HEAD");
}

async function runDetect(dir: string): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	try {
		const { stdout, stderr } = await execFileAsync(
			"bun",
			[path.join(VALIDATOR_ROOT, "src/index.ts"), "detect"],
			{
				cwd: dir,
				env: {
					...process.env,
					CI: undefined,
					GITHUB_ACTIONS: undefined,
					GITHUB_BASE_REF: undefined,
					GITHUB_SHA: undefined,
				},
			},
		);
		return { exitCode: 0, stdout, stderr };
	} catch (error) {
		const err = error as { code?: number; stdout?: string; stderr?: string };
		return {
			exitCode: err.code ?? 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

describe("detect trusted snapshots", () => {
	afterEach(async () => {
		for (const dir of tempDirs) {
			await fs.rm(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("reports no changes when a new branch points at a trusted commit", async () => {
		const repo = await createRepo();
		await trustHead(repo);
		await git(["checkout", "-b", "new-worktree-branch"], repo);

		const result = await runDetect(repo);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toContain("No changes detected.");
		expect(result.stdout).not.toContain("Found 1 changed files");
		await expect(
			fs.readFile(path.join(repo, "validator_logs", ".execution_state")),
		).rejects.toThrow();
	});

	it("preserves execution-state fixBase in rerun mode when one merge parent is trusted", async () => {
		const repo = await createRepo();
		const base = await git(["rev-parse", "base"], repo);
		await git(["checkout", "-b", "trusted-parent", base], repo);
		await fs.writeFile(path.join(repo, "trusted.ts"), "export const a = 1;\n");
		await git(["add", "trusted.ts"], repo);
		await git(["commit", "-m", "trusted parent"], repo);
		const trustedParent = await git(["rev-parse", "HEAD"], repo);
		await appendTrustedRecord(repo, trustedParent);

		await git(["checkout", "-b", "untrusted-parent", base], repo);
		await fs.writeFile(
			path.join(repo, "untrusted.ts"),
			"export const b = 1;\n",
		);
		await git(["add", "untrusted.ts"], repo);
		await git(["commit", "-m", "untrusted parent"], repo);

		await git(["checkout", "trusted-parent"], repo);
		await git(["merge", "--no-ff", "untrusted-parent", "-m", "merge"], repo);
		const mergeHead = await git(["rev-parse", "HEAD"], repo);
		await fs.mkdir(path.join(repo, "validator_logs"), { recursive: true });
		await fs.writeFile(
			path.join(repo, "validator_logs", "check_unit.1.log"),
			"previous failure\n",
			"utf-8",
		);
		await fs.writeFile(
			path.join(repo, "validator_logs", ".execution_state"),
			JSON.stringify({
				last_run_completed_at: "2026-01-01T00:00:00.000Z",
				branch: "trusted-parent",
				commit: mergeHead,
				working_tree_ref: mergeHead,
			}),
			"utf-8",
		);

		const result = await runDetect(repo);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toContain("No changes detected.");
		expect(result.stdout).not.toContain("untrusted.ts");
	});
});
