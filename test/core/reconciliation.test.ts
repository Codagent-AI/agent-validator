import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LoadedConfig } from "../../src/config/types.js";
import {
	reconcileDetect,
	reconcileStartup,
	type ReconciliationContinue,
} from "../../src/core/reconciliation.js";
import { readExecutionState } from "../../src/utils/execution-state.js";
import {
	appendRecord,
	computeTreeSha,
	readRecords,
	type TrustRecord,
} from "../../src/utils/trust-ledger.js";

const execFileAsync = promisify(execFile);

let repoDir: string;
let originalCwd: string;

async function git(args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd: repoDir });
	return stdout.trim();
}

async function writeFileAndCommit(file: string, content: string, message: string) {
	await fs.writeFile(path.join(repoDir, file), content, "utf-8");
	await git(["add", file]);
	await git(["commit", "-m", message]);
	return git(["rev-parse", "HEAD"]);
}

function testConfig(logDir: string): LoadedConfig {
	return {
		project: {
			base_branch: "main",
			log_dir: logDir,
			max_retries: 3,
			max_previous_logs: 3,
			debug_log: false,
			entry_points: [{ path: "src/**/*.ts", checks: ["unit"] }],
		},
		checks: {
			unit: {
				name: "unit",
				command: "true",
				run_in_ci: true,
				run_locally: true,
			},
		},
		reviews: {},
	} as unknown as LoadedConfig;
}

function trustedRecord(commit: string | null, tree: string): TrustRecord {
	return {
		commit,
		tree,
		config_hash: "config",
		scope: {
			command: "run",
			gates: [],
			entry_points: ["src/**/*.ts"],
			cli_overrides: {},
		},
		scope_hash: "scope",
		validator_version: "1.10.0",
		source: "validated",
		status: "passed",
		trusted: true,
		created_at: "2026-01-01T00:00:00.000Z",
	};
}

describe("startup reconciliation", () => {
	beforeEach(async () => {
		originalCwd = process.cwd();
		repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-reconcile-"));
		await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
		await execFileAsync("git", ["config", "user.email", "test@example.com"], {
			cwd: repoDir,
		});
		await execFileAsync("git", ["config", "user.name", "Test User"], {
			cwd: repoDir,
		});
		await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
		await writeFileAndCommit("src/app.ts", "export const value = 1;\n", "base");
		process.chdir(repoDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await fs.rm(repoDir, { recursive: true, force: true });
	});

	it("short-circuits when HEAD has a trusted commit record and advances state", async () => {
		const head = await git(["rev-parse", "HEAD"]);
		const tree = await computeTreeSha("HEAD");
		const logDir = path.join(repoDir, "validator_logs");
		await appendRecord(trustedRecord(head, tree));

		const result = await reconcileStartup({
			command: "run",
			config: testConfig(logDir),
			logDir,
		});

		expect(result.kind).toBe("trusted");
		if (result.kind === "trusted") {
			expect(result.result.status).toBe("trusted");
			expect(result.result.message).toContain(
				"Trusted snapshot; baseline advanced.",
			);
			expect(result.result.message).toContain(
				"https://github.com/Codagent-AI/agent-validator/blob/main/docs/trusted-snapshots.md",
			);
		}
		const state = await readExecutionState(logDir);
		expect(state?.commit).toBe(head);
		expect(state?.working_tree_ref).toBe(head);
	});

	it("detect reconciliation reports trusted HEAD without mutating state", async () => {
		const head = await git(["rev-parse", "HEAD"]);
		const tree = await computeTreeSha("HEAD");
		const logDir = path.join(repoDir, "validator_logs");
		await appendRecord(trustedRecord(head, tree));

		const result = await reconcileDetect();

		expect(result).toEqual({ kind: "trusted" });
		expect(await readExecutionState(logDir)).toBeNull();
		expect(await readRecords()).toHaveLength(1);
	});

	it("materializes a commit record when HEAD is trusted by tree match", async () => {
		const head = await git(["rev-parse", "HEAD"]);
		const tree = await computeTreeSha("HEAD");
		const logDir = path.join(repoDir, "validator_logs");
		await appendRecord(trustedRecord(null, tree));

		const result = await reconcileStartup({
			command: "run",
			config: testConfig(logDir),
			logDir,
		});

		expect(result.kind).toBe("trusted");
		const records = await readRecords();
		expect(records).toContainEqual(
			expect.objectContaining({
				commit: head,
				tree,
				source: "ledger-reconciled",
				trusted: true,
			}),
		);
	});

	it("skips reconciliation entirely when the worktree is dirty", async () => {
		const head = await git(["rev-parse", "HEAD"]);
		const tree = await computeTreeSha("HEAD");
		const logDir = path.join(repoDir, "validator_logs");
		await appendRecord(trustedRecord(head, tree));
		await fs.writeFile(
			path.join(repoDir, "src/app.ts"),
			"export const value = 2;\n",
			"utf-8",
		);

		const result = await reconcileStartup({
			command: "run",
			config: testConfig(logDir),
			logDir,
		});

		expect(result).toEqual({ kind: "continue" });
		expect(await readExecutionState(logDir)).toBeNull();
	});

	it("auto-promotes a two-parent merge when both parents are trusted and no resolution delta exists", async () => {
		const base = await git(["rev-parse", "HEAD"]);
		await git(["checkout", "-b", "feature-a"]);
		const parent1 = await writeFileAndCommit(
			"src/a.ts",
			"export const a = 1;\n",
			"a",
		);
		const parent1Tree = await computeTreeSha(parent1);
		await git(["checkout", "main"]);
		await git(["checkout", "-b", "feature-b", base]);
		const parent2 = await writeFileAndCommit(
			"src/b.ts",
			"export const b = 1;\n",
			"b",
		);
		const parent2Tree = await computeTreeSha(parent2);
		await appendRecord(trustedRecord(parent1, parent1Tree));
		await appendRecord(trustedRecord(parent2, parent2Tree));
		await git(["checkout", "feature-a"]);
		await git(["merge", "--no-ff", "feature-b", "-m", "merge"]);
		const mergeHead = await git(["rev-parse", "HEAD"]);
		const mergeTree = await computeTreeSha("HEAD");
		const logDir = path.join(repoDir, "validator_logs");

		const result = await reconcileStartup({
			command: "run",
			config: testConfig(logDir),
			logDir,
		});

		expect(result.kind).toBe("trusted");
		expect(await readRecords()).toContainEqual(
			expect.objectContaining({
				commit: mergeHead,
				tree: mergeTree,
				source: "ledger-reconciled",
				trusted: true,
			}),
		);
	});

	it("scopes validation to the synthetic tree when both trusted parents have a resolution delta", async () => {
		const base = await git(["rev-parse", "HEAD"]);
		await git(["checkout", "-b", "feature-a"]);
		const parent1 = await writeFileAndCommit(
			"src/app.ts",
			"export const value = 2;\n",
			"a",
		);
		await git(["checkout", "main"]);
		await git(["checkout", "-b", "feature-b", base]);
		const parent2 = await writeFileAndCommit(
			"src/app.ts",
			"export const value = 3;\n",
			"b",
		);
		await appendRecord(trustedRecord(parent1, await computeTreeSha(parent1)));
		await appendRecord(trustedRecord(parent2, await computeTreeSha(parent2)));
		await git(["checkout", "feature-a"]);
		await git(["merge", "--no-ff", "feature-b", "-m", "merge"]).catch(
			() => undefined,
		);
		await fs.writeFile(
			path.join(repoDir, "src/app.ts"),
			"export const value = 4;\n",
			"utf-8",
		);
		await git(["add", "src/app.ts"]);
		await git(["commit", "-m", "merge"]);
		const logDir = path.join(repoDir, "validator_logs");

		const result = await reconcileStartup({
			command: "run",
			config: testConfig(logDir),
			logDir,
		});

		expect(result.kind).toBe("continue");
		const continued = result as ReconciliationContinue;
		expect(continued.changeOptions?.fixBase).toMatch(/^[0-9a-f]{40}$/);
		expect(continued.trustSourceOnPass).toBe("ledger-reconciled");
	});

	it("scopes validation to the trusted parent when exactly one merge parent is trusted", async () => {
		const base = await git(["rev-parse", "HEAD"]);
		await git(["checkout", "-b", "feature-a"]);
		const parent1 = await writeFileAndCommit(
			"src/a.ts",
			"export const a = 1;\n",
			"a",
		);
		await git(["checkout", "main"]);
		await git(["checkout", "-b", "feature-b", base]);
		await writeFileAndCommit("src/b.ts", "export const b = 1;\n", "b");
		await appendRecord(trustedRecord(parent1, await computeTreeSha(parent1)));
		await git(["checkout", "feature-a"]);
		await git(["merge", "--no-ff", "feature-b", "-m", "merge"]);
		const logDir = path.join(repoDir, "validator_logs");

		const result = await reconcileStartup({
			command: "run",
			config: testConfig(logDir),
			logDir,
		});

		expect(result.kind).toBe("continue");
		expect((result as ReconciliationContinue).changeOptions?.fixBase).toBe(
			parent1,
		);
	});
});
