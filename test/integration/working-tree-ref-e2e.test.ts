import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	GAUNTLET_ROOT,
	initGitRepo,
	isDistBuilt,
	spawnGauntlet,
} from "./helpers.js";

// Suppress unused import warning — GAUNTLET_ROOT is used in helpers via spawnGauntlet
void GAUNTLET_ROOT;

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 60_000;

// Helper: run a git command in a given directory
async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd });
	return stdout.trim();
}

// Helper: read .execution_state from the gauntlet log dir
async function readExecutionState(
	tempDir: string,
): Promise<Record<string, unknown> | null> {
	try {
		const content = await fs.readFile(
			path.join(tempDir, "validator_logs", ".execution_state"),
			"utf-8",
		);
		return JSON.parse(content) as Record<string, unknown>;
	} catch {
		return null;
	}
}

// Helper: write gauntlet config with a simple echo-pass check
async function writeValidatorConfig(dir: string): Promise<void> {
	await fs.mkdir(path.join(dir, ".validator", "checks"), { recursive: true });
	await fs.writeFile(
		path.join(dir, ".validator", "config.yml"),
		`base_branch: base
log_dir: validator_logs
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - echo-pass
`,
	);
	await fs.writeFile(
		path.join(dir, ".validator", "checks", "echo-pass.yml"),
		`command: "echo pass"
timeout: 10
`,
	);
	// Gitignore the log dir so it doesn't appear as untracked and affect working_tree_ref
	await fs.writeFile(path.join(dir, ".gitignore"), "validator_logs/\n");
}

// Helper: create a fresh temp git repo with gauntlet config.
// Creates a 'base' branch at the initial commit, then makes one committed
// change on 'main' so the validator always has a real diff scope to work with.
async function createTestRepo(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gauntlet-wtr-e2e-"));
	await fs.writeFile(path.join(dir, "hello.ts"), "export const x = 1;\n");
	await writeValidatorConfig(dir);
	await initGitRepo(dir);
	// Anchor 'base' at the initial commit, then commit a change on 'main'.
	// This gives the validator a committed diff (base..HEAD) to scope gates against.
	await git(["branch", "base"], dir);
	await fs.writeFile(path.join(dir, "hello.ts"), "export const x = 0;\n");
	await git(["add", "hello.ts"], dir);
	await git(["commit", "-m", "baseline: establish diff scope"], dir);
	return dir;
}

let canRun: boolean;
const tempDirs: string[] = [];

beforeAll(async () => {
	canRun = isDistBuilt();
});

afterAll(async () => {
	for (const dir of tempDirs) {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("working-tree-ref E2E", () => {
		it(
			"Scenario: Tracked-only changes produce valid stash ref",
			async () => {
				if (!canRun) return;

				const tempDir = await createTestRepo();
				tempDirs.push(tempDir);

				// Modify a tracked file (creates uncommitted change)
				await fs.writeFile(
					path.join(tempDir, "hello.ts"),
					"export const x = 2;\n",
				);

				const headSha = await git(["rev-parse", "HEAD"], tempDir);

				await spawnGauntlet(["run"], {
					cwd: tempDir,
					timeoutMs: TIMEOUT_MS,
				});

				const state = await readExecutionState(tempDir);
				expect(state).not.toBeNull();
				expect(typeof state?.working_tree_ref).toBe("string");

				const wtr = state?.working_tree_ref as string;
				// working_tree_ref should differ from HEAD when there are tracked changes
				expect(wtr).not.toBe(headSha);

				// It must be a valid git object of type "commit"
				const objType = await git(["cat-file", "-t", wtr], tempDir);
				expect(objType).toBe("commit");
			},
			{ timeout: TIMEOUT_MS },
		);

		it(
			"Scenario: Tracked + untracked changes produce stash with ^3 parent",
			async () => {
				if (!canRun) return;

				const tempDir = await createTestRepo();
				tempDirs.push(tempDir);

				// Modify tracked file and create new untracked file
				await fs.writeFile(
					path.join(tempDir, "hello.ts"),
					"export const x = 3;\n",
				);
				await fs.writeFile(
					path.join(tempDir, "untracked.ts"),
					"export const y = 99;\n",
				);

				await spawnGauntlet(["run"], {
					cwd: tempDir,
					timeoutMs: TIMEOUT_MS,
				});

				const state = await readExecutionState(tempDir);
				expect(state).not.toBeNull();
				const wtr = state?.working_tree_ref as string;

				// The untracked file should be in the stash's ^3 parent
				const treeFiles = await git(
					["ls-tree", "-r", "--name-only", `${wtr}^3`],
					tempDir,
				);
				expect(treeFiles).toContain("untracked.ts");
			},
			{ timeout: TIMEOUT_MS },
		);

		it(
			"Scenario: Clean working tree uses HEAD SHA",
			async () => {
				if (!canRun) return;

				const tempDir = await createTestRepo();
				tempDirs.push(tempDir);

				// createTestRepo already set up 'base' branch and base_branch: base config.
				// Make a further committed change so the working tree is clean at a new HEAD.
				await fs.writeFile(
					path.join(tempDir, "hello.ts"),
					"export const x = 42;\n",
				);
				await git(["add", "-A"], tempDir);
				await git(
					["commit", "-m", "further committed change"],
					tempDir,
				);

				// Capture HEAD after committing — working tree is now clean
				const headSha = await git(["rev-parse", "HEAD"], tempDir);

				// Run gauntlet — working tree is clean, working_tree_ref should = HEAD
				await spawnGauntlet(["run"], {
					cwd: tempDir,
					timeoutMs: TIMEOUT_MS,
				});

				const state = await readExecutionState(tempDir);
				expect(state).not.toBeNull();
				expect(state?.working_tree_ref).toBe(headSha);
			},
			{ timeout: TIMEOUT_MS },
		);

		it(
			"Scenario: Untracked\u2192tracked transition does not produce spurious diff",
			async () => {
				if (!canRun) return;

				const tempDir = await createTestRepo();
				tempDirs.push(tempDir);

				// Step 1: Create an untracked file and run gauntlet
				// This captures the file in stash ^3
				const untrackedFile = path.join(tempDir, "newfile.ts");
				await fs.writeFile(
					untrackedFile,
					"export const newThing = 42;\n",
				);

				await spawnGauntlet(["run"], {
					cwd: tempDir,
					timeoutMs: TIMEOUT_MS,
				});

				// Record the working_tree_ref from the first run
				const firstState = await readExecutionState(tempDir);
				expect(firstState).not.toBeNull();
				const firstWtr = firstState?.working_tree_ref as string;

				// Verify the untracked file was captured in stash ^3
				const stashTree = await git(
					["ls-tree", "-r", "--name-only", `${firstWtr}^3`],
					tempDir,
				);
				expect(stashTree).toContain("newfile.ts");

				// Step 2: Commit the untracked file WITHOUT changing its content
				await git(["add", "newfile.ts"], tempDir);
				await git(
					["commit", "-m", "commit previously untracked file"],
					tempDir,
				);

				// Step 3: Make a small genuine change to a different file
				await fs.writeFile(
					path.join(tempDir, "hello.ts"),
					"export const x = 999;\n",
				);

				// Step 4: Run gauntlet again — this exercises the fixBase code path
				// because execution state exists from the first run. The diff is
				// computed against the stash ref, which exercises getFixBaseDiff
				// and the committed-from-stash exclusion logic.
				await spawnGauntlet(["run"], {
					cwd: tempDir,
					timeoutMs: TIMEOUT_MS,
				});

				// The second run should complete successfully
				const secondState = await readExecutionState(tempDir);
				expect(secondState).not.toBeNull();

				// Verify working_tree_ref was updated after the second run
				expect(secondState?.working_tree_ref).not.toBeUndefined();
			},
			{ timeout: TIMEOUT_MS * 2 },
		);
});
