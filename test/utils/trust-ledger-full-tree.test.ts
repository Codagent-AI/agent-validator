import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LoadedConfig } from "../../src/config/types.js";
import {
	appendCurrentTrustRecord,
	readRecords,
} from "../../src/utils/trust-ledger.js";

const execFileAsync = promisify(execFile);

let repoDir: string;
let originalCwd: string;

async function git(args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd: repoDir });
	return stdout.trim();
}

function testConfig(logDir: string): LoadedConfig {
	return {
		project: {
			base_branch: "main",
			log_dir: logDir,
			max_retries: 3,
			max_previous_logs: 3,
			debug_log: false,
			entry_points: [{ path: ".", checks: ["unit"] }],
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

describe.serial("trust ledger full dirty-tree snapshots", () => {
	beforeEach(async () => {
		originalCwd = process.cwd();
		repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-ledger-tree-"));
		await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
		await execFileAsync("git", ["config", "user.email", "test@example.com"], {
			cwd: repoDir,
		});
		await execFileAsync("git", ["config", "user.name", "Test User"], {
			cwd: repoDir,
		});
		await fs.writeFile(path.join(repoDir, "tracked.ts"), "export const a = 1;\n");
		await fs.writeFile(path.join(repoDir, ".gitignore"), "validator_logs/\n");
		await git(["add", "tracked.ts"]);
		await git(["add", ".gitignore"]);
		await git(["commit", "-m", "base"]);
		process.chdir(repoDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await fs.rm(repoDir, { recursive: true, force: true });
	});

	it("records a tree that matches the later commit when dirty validation included untracked files", async () => {
		await fs.writeFile(path.join(repoDir, "tracked.ts"), "export const a = 2;\n");
		await fs.writeFile(
			path.join(repoDir, "zz-café.ts "),
			"export const b = 1;\n",
		);

		await git(["stash", "push", "--include-untracked", "-m", "snapshot"]);
		const workingTreeRef = await git(["rev-parse", "stash@{0}"]);
		await git(["stash", "pop"]);
		const logDir = path.join(repoDir, "validator_logs");
		await fs.mkdir(logDir, { recursive: true });
		await fs.writeFile(
			path.join(logDir, ".execution_state"),
			JSON.stringify({
				last_run_completed_at: "2026-01-01T00:00:00.000Z",
				branch: "main",
				commit: await git(["rev-parse", "HEAD"]),
				working_tree_ref: workingTreeRef,
			}),
			"utf-8",
		);

		await appendCurrentTrustRecord({
			config: testConfig(logDir),
			logDir,
			command: "run",
			status: "passed",
			source: "validated",
		});
		await git(["add", "-A"]);
		await git(["commit", "-m", "commit validated content"]);
		const committedTree = await git(["rev-parse", "HEAD^{tree}"]);

		const [record] = await readRecords();
		expect(record.commit).toBeNull();
		expect(record.working_tree_ref).toBe(workingTreeRef);
		expect(record.tree).toBe(committedTree);
	});
});
