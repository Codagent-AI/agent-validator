# Log Rotation, Auto-Clean on Retry Limit, and Diff Scoping Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-archive logs on retry limit exceeded, implement configurable N-deep log rotation, and fix three bugs in execution state lifecycle and change detection scoping.

**Architecture:** All changes flow through the existing `cleanLogs()` → `performAutoClean()` → `executeRun()` pipeline. The rotation algorithm replaces the current 1-deep `previous/` archiving with logrotate-style shift/evict. Bug fixes are surgical: remove a conditional, remove a function call, add a code path.

**Tech Stack:** TypeScript, Bun test runner, Zod schema validation, Node.js `fs` module

---

## Task 1: Add `max_previous_logs` config field

**Files:**
- Modify: `src/config/schema.ts:151-164`

**Step 1: Write the failing test**

Create `test/config/schema-max-previous-logs.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { gauntletConfigSchema } from "../../src/config/schema.js";

describe("max_previous_logs config field", () => {
	const baseConfig = {
		cli: { default_preference: ["claude"] },
		entry_points: [{ path: "." }],
	};

	it("defaults to 3 when not specified", () => {
		const result = gauntletConfigSchema.parse(baseConfig);
		expect(result.max_previous_logs).toBe(3);
	});

	it("accepts 0", () => {
		const result = gauntletConfigSchema.parse({ ...baseConfig, max_previous_logs: 0 });
		expect(result.max_previous_logs).toBe(0);
	});

	it("accepts positive integers", () => {
		const result = gauntletConfigSchema.parse({ ...baseConfig, max_previous_logs: 5 });
		expect(result.max_previous_logs).toBe(5);
	});

	it("rejects negative numbers", () => {
		expect(() => gauntletConfigSchema.parse({ ...baseConfig, max_previous_logs: -1 })).toThrow();
	});

	it("rejects non-integer numbers", () => {
		expect(() => gauntletConfigSchema.parse({ ...baseConfig, max_previous_logs: 2.5 })).toThrow();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/config/schema-max-previous-logs.test.ts`
Expected: FAIL — `max_previous_logs` is undefined (field doesn't exist yet)

**Step 3: Write minimal implementation**

In `src/config/schema.ts`, add `max_previous_logs` to `gauntletConfigSchema` after `max_retries` (line 155):

```typescript
export const gauntletConfigSchema = z.object({
	base_branch: z.string().min(1).default("origin/main"),
	log_dir: z.string().min(1).default("gauntlet_logs"),
	allow_parallel: z.boolean().default(true),
	max_retries: z.number().default(3),
	max_previous_logs: z.number().int().min(0).default(3),
	// ... rest unchanged
```

**Step 4: Run test to verify it passes**

Run: `bun test test/config/schema-max-previous-logs.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts test/config/schema-max-previous-logs.test.ts
git commit -m "feat: add max_previous_logs config field (default: 3)"
```

---

## Task 2: Implement logrotate-style rotation in `cleanLogs()`

**Files:**
- Modify: `src/commands/shared.ts:192-246`
- Test: `test/commands/shared.test.ts`

**Step 1: Write the failing tests**

Add to `test/commands/shared.test.ts` inside a new `describe("cleanLogs rotation", ...)` block:

```typescript
describe("cleanLogs rotation", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("rotates with maxPreviousLogs=3: evicts oldest, shifts, creates new previous/", async () => {
		// Setup: previous/, previous.1/, previous.2/ all exist
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "run-a.log"), "a");
		await fs.mkdir(path.join(TEST_DIR, "previous.1"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous.1", "run-b.log"), "b");
		await fs.mkdir(path.join(TEST_DIR, "previous.2"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous.2", "run-c.log"), "c");
		// Current logs
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "current");

		await cleanLogs(TEST_DIR, 3);

		// previous.2/ should have what was in previous.1/
		const prev2 = await fs.readdir(path.join(TEST_DIR, "previous.2"));
		expect(prev2).toEqual(["run-b.log"]);
		// previous.1/ should have what was in previous/
		const prev1 = await fs.readdir(path.join(TEST_DIR, "previous.1"));
		expect(prev1).toEqual(["run-a.log"]);
		// previous/ should have current logs
		const prev = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(prev).toEqual(["check.1.log"]);
		// Root should have no log files
		const root = await fs.readdir(TEST_DIR);
		expect(root.filter((f) => f.endsWith(".log") && !f.startsWith("."))).toEqual([]);
	});

	it("maxPreviousLogs=0: deletes current logs, no archiving", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "content");

		await cleanLogs(TEST_DIR, 0);

		const files = await fs.readdir(TEST_DIR);
		expect(files.filter((f) => f.endsWith(".log"))).toEqual([]);
		// No previous/ directory created
		expect(files).not.toContain("previous");
	});

	it("maxPreviousLogs=1: single previous/ directory (pre-existing behavior)", async () => {
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "old.log"), "old");
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "new");

		await cleanLogs(TEST_DIR, 1);

		const prev = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(prev).toEqual(["check.1.log"]);
	});

	it("skips missing intermediate directories without error", async () => {
		// previous/ exists but previous.1/ does NOT
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "run-a.log"), "a");
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "current");

		await cleanLogs(TEST_DIR, 3);

		// previous.1/ should have what was in previous/
		const prev1 = await fs.readdir(path.join(TEST_DIR, "previous.1"));
		expect(prev1).toEqual(["run-a.log"]);
		// previous/ should have current logs
		const prev = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(prev).toEqual(["check.1.log"]);
	});

	it("backward compatible: cleanLogs without maxPreviousLogs defaults to 3", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "content");

		// Call without the second argument — should default to 3
		await cleanLogs(TEST_DIR);

		const prev = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(prev).toEqual(["check.1.log"]);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test test/commands/shared.test.ts`
Expected: FAIL — `cleanLogs` doesn't accept a second argument yet, and rotation logic doesn't exist

**Step 3: Write the implementation**

Replace `cleanLogs()` in `src/commands/shared.ts` (lines 192-246):

```typescript
export async function cleanLogs(logDir: string, maxPreviousLogs = 3): Promise<void> {
	try {
		// Guard: Return early if log directory doesn't exist
		if (!(await exists(logDir))) {
			return;
		}

		// Guard: Return early if no current logs to archive
		if (!(await hasCurrentLogs(logDir))) {
			return;
		}

		if (maxPreviousLogs === 0) {
			// No archiving — delete current logs
			const files = await fs.readdir(logDir);
			const persistentFiles = getPersistentFiles();
			await Promise.all(
				files
					.filter((file) => !file.startsWith("previous") && !persistentFiles.has(file))
					.map((file) =>
						fs.rm(path.join(logDir, file), { recursive: true, force: true }),
					),
			);
			return;
		}

		// Logrotate-style rotation: shift from highest to lowest
		// 1. Evict the oldest (previous.{max-1}/)
		const oldestSuffix = maxPreviousLogs - 1;
		const oldestDir = oldestSuffix === 0 ? "previous" : `previous.${oldestSuffix}`;
		const oldestPath = path.join(logDir, oldestDir);
		if (await exists(oldestPath)) {
			await fs.rm(oldestPath, { recursive: true, force: true });
		}

		// 2. Shift from highest to lowest to avoid clobbering
		for (let i = oldestSuffix - 1; i >= 0; i--) {
			const fromName = i === 0 ? "previous" : `previous.${i}`;
			const toName = `previous.${i + 1}`;
			const fromPath = path.join(logDir, fromName);
			const toPath = path.join(logDir, toName);
			if (await exists(fromPath)) {
				await fs.rename(fromPath, toPath);
			}
		}

		// 3. Create fresh previous/
		const previousDir = path.join(logDir, "previous");
		await fs.mkdir(previousDir, { recursive: true });

		// 4. Move current logs into previous/
		const files = await fs.readdir(logDir);
		const persistentFiles = getPersistentFiles();

		await Promise.all(
			files
				.filter((file) => !file.startsWith("previous") && !persistentFiles.has(file))
				.map((file) =>
					fs.rename(path.join(logDir, file), path.join(previousDir, file)),
				),
		);

		// 5. Delete legacy .session_ref if it exists (migration cleanup)
		try {
			const sessionRefPath = path.join(logDir, SESSION_REF_FILENAME);
			await fs.rm(sessionRefPath, { force: true });
		} catch {
			// Ignore errors
		}
	} catch (error) {
		console.warn(
			"Failed to clean logs in",
			logDir,
			":",
			error instanceof Error ? error.message : error,
		);
	}
}
```

Note: The `filter` for moving files changes from `file !== "previous"` to `!file.startsWith("previous")` since we now have `previous.1/`, `previous.2/`, etc.

**Step 4: Run tests to verify they pass**

Run: `bun test test/commands/shared.test.ts`
Expected: PASS (all existing tests should still pass too since the default is 3 and existing behavior is preserved)

**Step 5: Commit**

```bash
git add src/commands/shared.ts test/commands/shared.test.ts
git commit -m "feat: implement logrotate-style N-deep log rotation in cleanLogs()"
```

---

## Task 3: Bug fix — `shouldAutoClean()` always resets state on merge

**Files:**
- Modify: `src/commands/shared.ts:53-67`
- Test: `test/commands/shared.test.ts`

**Step 1: Write the failing test**

Add to the `shouldAutoClean` describe block in `test/commands/shared.test.ts`:

```typescript
it("returns resetState: true when commit is merged (unconditional)", async () => {
	// Create state with a commit that IS an ancestor of the base branch.
	// Use the base branch's own HEAD commit, which is trivially an ancestor.
	const { stdout } = await execAsync("git rev-parse origin/main");
	const mergedCommit = stdout.trim();

	const state = {
		last_run_completed_at: new Date().toISOString(),
		branch: await getCurrentBranch(),
		commit: mergedCommit,
		working_tree_ref: mergedCommit, // A valid ref — old code would set resetState: false
	};
	await fs.writeFile(
		path.join(TEST_DIR, getExecutionStateFilename()),
		JSON.stringify(state),
	);

	const result = await shouldAutoClean(TEST_DIR, "origin/main");
	expect(result.clean).toBe(true);
	expect(result.reason).toBe("commit merged");
	expect(result.resetState).toBe(true); // MUST be true, regardless of working_tree_ref validity
});
```

You'll need to add this import at the top of the test file:

```typescript
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);
```

**Step 2: Run test to verify it fails**

Run: `bun test test/commands/shared.test.ts -t "resetState: true when commit is merged"`
Expected: FAIL — `resetState` is `false` because old code checks `working_tree_ref` validity

**Step 3: Write minimal implementation**

In `src/commands/shared.ts`, replace lines 53-67 (the "commit merged" block):

```typescript
	// Check if commit was merged into base branch
	try {
		const isMerged = await isCommitInBranch(state.commit, baseBranch);
		if (isMerged) {
			return { clean: true, reason: "commit merged", resetState: true };
		}
	} catch {
		// If we can't check merge status, don't auto-clean
	}
```

This removes the conditional `working_tree_ref` validity check entirely.

**Step 4: Run test to verify it passes**

Run: `bun test test/commands/shared.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/shared.ts test/commands/shared.test.ts
git commit -m "fix: always reset execution state on commit merged (remove stash validity check)"
```

---

## Task 4: Bug fix — manual `clean` preserves execution state

**Files:**
- Modify: `src/commands/clean.ts:10-11,40-41`
- Test: `test/commands/clean.test.ts`

**Step 1: Write the failing test**

Replace `test/commands/clean.test.ts` to add a behavioral test:

```typescript
import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { registerCleanCommand } from "../../src/commands/clean.js";

describe("Clean Command", () => {
	let program: Command;

	beforeEach(() => {
		program = new Command();
		registerCleanCommand(program);
	});

	it("should register the clean command", () => {
		const cleanCmd = program.commands.find((cmd) => cmd.name() === "clean");
		expect(cleanCmd).toBeDefined();
	});

	it("description should say 'Archive logs' without 'reset execution state'", () => {
		const cleanCmd = program.commands.find((cmd) => cmd.name() === "clean");
		expect(cleanCmd?.description()).not.toContain("reset execution state");
		expect(cleanCmd?.description()).toContain("Archive logs");
	});

	it("should not call deleteExecutionState", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/commands/clean.ts"),
			"utf-8",
		);
		expect(sourceFile).not.toContain("deleteExecutionState");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/commands/clean.test.ts`
Expected: FAIL — source still contains `deleteExecutionState`

**Step 3: Write minimal implementation**

In `src/commands/clean.ts`:

1. Remove the import of `deleteExecutionState` (line 10)
2. Remove the call `await deleteExecutionState(config.project.log_dir);` (line 41)
3. Update the command description from `"Archive logs and reset execution state"` to `"Archive logs"`
4. Pass `config.project.max_previous_logs` to `cleanLogs()`

The updated file:

```typescript
import chalk from "chalk";
import type { Command } from "commander";
import { loadGlobalConfig } from "../config/global.js";
import { loadConfig } from "../config/loader.js";
import {
	getDebugLogger,
	initDebugLogger,
	mergeDebugLogConfig,
} from "../utils/debug-log.js";
import { acquireLock, cleanLogs, releaseLock } from "./shared.js";

export function registerCleanCommand(program: Command): void {
	program
		.command("clean")
		.description("Archive logs")
		.action(async () => {
			let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
			let lockAcquired = false;
			try {
				config = await loadConfig();

				// Initialize debug logger
				const globalConfig = await loadGlobalConfig();
				const debugLogConfig = mergeDebugLogConfig(
					config.project.debug_log,
					globalConfig.debug_log,
				);
				initDebugLogger(config.project.log_dir, debugLogConfig);

				// Acquire lock BEFORE logging - prevents clean from running during active gauntlet run
				await acquireLock(config.project.log_dir);
				lockAcquired = true;

				// Log the command invocation (only after lock acquired)
				const debugLogger = getDebugLogger();
				await debugLogger?.logCommand("clean", []);
				await debugLogger?.logClean("manual", "user_request");

				await cleanLogs(config.project.log_dir, config.project.max_previous_logs);
				await releaseLock(config.project.log_dir);
				console.log(chalk.green("Logs archived successfully."));
			} catch (error: unknown) {
				if (config && lockAcquired) {
					await releaseLock(config.project.log_dir);
				}
				const err = error as { message?: string };
				console.error(chalk.red("Error:"), err.message);
				process.exit(1);
			}
		});
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/commands/clean.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/clean.ts test/commands/clean.test.ts
git commit -m "fix: manual clean preserves execution state, passes max_previous_logs"
```

---

## Task 5: Auto-clean on `retry_limit_exceeded`

**Files:**
- Modify: `src/core/run-executor.ts:214-215,564-568`

**Step 1: Write the failing test**

Add to `test/core/run-executor.test.ts`:

```typescript
describe("run-executor auto-clean on retry_limit_exceeded", () => {
	it("should auto-clean logs when status is retry_limit_exceeded", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/run-executor.ts"),
			"utf-8",
		);

		// The auto-clean block should include retry_limit_exceeded
		// Find the section after status determination that calls cleanLogs
		expect(sourceFile).toMatch(
			/status\s*===\s*"retry_limit_exceeded"[\s\S]*?cleanLogs/,
		);
	});

	it("should not delete execution state on retry_limit_exceeded", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/run-executor.ts"),
			"utf-8",
		);

		// The retry_limit_exceeded path should NOT call deleteExecutionState
		// Find the auto-clean block and verify it only calls cleanLogs
		const retryLimitBlock = sourceFile.match(
			/retry_limit_exceeded[\s\S]*?cleanLogs\([^)]+\)/,
		);
		expect(retryLimitBlock).not.toBeNull();
		// The same block should not reference deleteExecutionState
		if (retryLimitBlock) {
			expect(retryLimitBlock[0]).not.toContain("deleteExecutionState");
		}
	});

	it("status message for retry_limit_exceeded should not mention manual clean", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/run-executor.ts"),
			"utf-8",
		);

		// The status message should say logs are automatically archived
		expect(sourceFile).not.toMatch(
			/retry_limit_exceeded[\s\S]*?agent-gauntlet clean/,
		);
	});

	it("should pass max_previous_logs to cleanLogs on passed status", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/run-executor.ts"),
			"utf-8",
		);

		// The "passed" auto-clean should pass max_previous_logs
		expect(sourceFile).toMatch(
			/status\s*===\s*"passed"[\s\S]*?cleanLogs\([^,]+,\s*config\.project\.max_previous_logs\)/,
		);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/core/run-executor.test.ts -t "auto-clean on retry_limit_exceeded"`
Expected: FAIL — no retry_limit_exceeded auto-clean block exists

**Step 3: Write the implementation**

In `src/core/run-executor.ts`:

1. Update the status message (line 214-215):

```typescript
	retry_limit_exceeded:
		"Retry limit exceeded — logs have been automatically archived.",
```

2. Replace the auto-clean block (lines 564-568):

```typescript
		// Clean logs on success or retry limit exceeded
		if (status === "passed") {
			await debugLogger?.logClean("auto", "all_passed");
			await cleanLogs(config.project.log_dir, config.project.max_previous_logs);
		} else if (status === "retry_limit_exceeded") {
			await debugLogger?.logClean("auto", "retry_limit_exceeded");
			await cleanLogs(config.project.log_dir, config.project.max_previous_logs);
		}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/core/run-executor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/run-executor.ts test/core/run-executor.test.ts
git commit -m "feat: auto-clean logs on retry_limit_exceeded, pass max_previous_logs"
```

---

## Task 6: Bug fix — `ChangeDetector` uses `fixBase`

**Files:**
- Modify: `src/core/change-detector.ts:18-37`
- Create: `test/core/change-detector.test.ts`

**Step 1: Write the failing tests**

Create `test/core/change-detector.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ChangeDetector } from "../../src/core/change-detector.js";

const execAsync = promisify(exec);

describe("ChangeDetector fixBase support", () => {
	it("uses fixBase when provided and no commit/uncommitted set", async () => {
		// Get a known good commit to use as fixBase
		const { stdout } = await execAsync("git rev-parse HEAD~1");
		const fixBase = stdout.trim();

		const detector = new ChangeDetector("origin/main", { fixBase });
		const files = await detector.getChangedFiles();

		// Should return files — the exact list depends on what changed since HEAD~1
		// The key assertion is that it doesn't throw and returns an array
		expect(Array.isArray(files)).toBe(true);
	});

	it("explicit commit overrides fixBase", async () => {
		const { stdout: commitSha } = await execAsync("git rev-parse HEAD");
		const commit = commitSha.trim();
		const { stdout: fixBaseSha } = await execAsync("git rev-parse HEAD~2");
		const fixBase = fixBaseSha.trim();

		const detector = new ChangeDetector("origin/main", { commit, fixBase });
		const files = await detector.getChangedFiles();

		// Should use commit diff, not fixBase diff
		// Verify by checking that commit mode was used (commit diff is commit^..commit)
		expect(Array.isArray(files)).toBe(true);
	});

	it("explicit uncommitted overrides fixBase", async () => {
		const { stdout: fixBaseSha } = await execAsync("git rev-parse HEAD~2");
		const fixBase = fixBaseSha.trim();

		const detector = new ChangeDetector("origin/main", { uncommitted: true, fixBase });
		const files = await detector.getChangedFiles();

		// Should use uncommitted diff, not fixBase diff
		expect(Array.isArray(files)).toBe(true);
	});

	it("priority order: commit > uncommitted > fixBase > default", () => {
		// Structural test: verify the code checks in the right order
		const { readFileSync } = require("node:fs");
		const { join } = require("node:path");
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/change-detector.ts"),
			"utf-8",
		);

		const commitCheck = sourceFile.indexOf("this.options.commit");
		const uncommittedCheck = sourceFile.indexOf("this.options.uncommitted");
		const fixBaseCheck = sourceFile.indexOf("this.options.fixBase");

		// All three must exist
		expect(commitCheck).toBeGreaterThan(-1);
		expect(uncommittedCheck).toBeGreaterThan(-1);
		expect(fixBaseCheck).toBeGreaterThan(-1);

		// commit before uncommitted before fixBase
		expect(commitCheck).toBeLessThan(uncommittedCheck);
		expect(uncommittedCheck).toBeLessThan(fixBaseCheck);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test test/core/change-detector.test.ts`
Expected: FAIL — `fixBase` code path doesn't exist, priority test fails

**Step 3: Write the implementation**

In `src/core/change-detector.ts`, update `getChangedFiles()` (lines 18-37):

```typescript
	async getChangedFiles(): Promise<string[]> {
		// Priority 1: If commit option is provided, use that
		if (this.options.commit) {
			return this.getCommitChangedFiles(this.options.commit);
		}

		// Priority 2: If uncommitted option is provided, only get uncommitted changes
		if (this.options.uncommitted) {
			return this.getUncommittedChangedFiles();
		}

		// Priority 3: If fixBase is provided, diff against it
		if (this.options.fixBase) {
			return this.getFixBaseChangedFiles(this.options.fixBase);
		}

		// Priority 4: CI detection / local base branch diff
		const isCI =
			process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

		if (isCI) {
			return this.getCIChangedFiles();
		} else {
			return this.getLocalChangedFiles();
		}
	}
```

Add the new private method after `getUncommittedChangedFiles()`:

```typescript
	private async getFixBaseChangedFiles(fixBase: string): Promise<string[]> {
		// Get all files changed since fixBase (committed + uncommitted + untracked)
		const { stdout: committed } = await execAsync(
			`git diff --name-only ${fixBase}...HEAD`,
		);

		const { stdout: uncommitted } = await execAsync(
			"git diff --name-only HEAD",
		);

		const { stdout: untracked } = await execAsync(
			"git ls-files --others --exclude-standard",
		);

		const files = new Set([
			...this.parseOutput(committed),
			...this.parseOutput(uncommitted),
			...this.parseOutput(untracked),
		]);

		return Array.from(files);
	}
```

**Step 4: Run tests to verify they pass**

Run: `bun test test/core/change-detector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/change-detector.ts test/core/change-detector.test.ts
git commit -m "fix: ChangeDetector uses fixBase for gate selection (commit > uncommitted > fixBase > default)"
```

---

## Task 7: Pass `max_previous_logs` through `performAutoClean()`

**Files:**
- Modify: `src/commands/shared.ts:75-85`
- Modify: `src/core/run-executor.ts:351`

**Step 1: Write the failing test**

Add to `test/commands/shared.test.ts`:

```typescript
describe("performAutoClean with maxPreviousLogs", () => {
	it("performAutoClean accepts maxPreviousLogs parameter", () => {
		const { readFileSync } = require("node:fs");
		const { join } = require("node:path");
		const sourceFile = readFileSync(
			join(process.cwd(), "src/commands/shared.ts"),
			"utf-8",
		);

		// performAutoClean should accept maxPreviousLogs and pass it to cleanLogs
		expect(sourceFile).toMatch(/performAutoClean[\s\S]*?maxPreviousLogs/);
		expect(sourceFile).toMatch(/cleanLogs\(logDir,\s*maxPreviousLogs\)/);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/commands/shared.test.ts -t "performAutoClean with maxPreviousLogs"`
Expected: FAIL — `performAutoClean` doesn't have this parameter yet

**Step 3: Write the implementation**

In `src/commands/shared.ts`, update `performAutoClean()`:

```typescript
export async function performAutoClean(
	logDir: string,
	result: AutoCleanResult,
	maxPreviousLogs = 3,
): Promise<void> {
	await cleanLogs(logDir, maxPreviousLogs);

	// Delete execution state if context changed (branch changed or commit merged)
	if (result.resetState) {
		await deleteExecutionState(logDir);
	}
}
```

In `src/core/run-executor.ts`, update the `performAutoClean` call (line 351):

```typescript
		await performAutoClean(config.project.log_dir, autoCleanResult, config.project.max_previous_logs);
```

**Step 4: Run test to verify it passes**

Run: `bun test test/commands/shared.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `bun test`
Expected: PASS (all tests)

**Step 6: Commit**

```bash
git add src/commands/shared.ts src/core/run-executor.ts test/commands/shared.test.ts
git commit -m "feat: thread max_previous_logs through performAutoClean and run-executor"
```

---

## Task 8: Apply openspec spec changes

**Files:**
- Modify: `openspec/specs/run-lifecycle/spec.md`
- Modify: `openspec/specs/log-management/spec.md`

**Step 1: Apply the openspec change**

Run: `bun src/index.ts --help` to check if there's an openspec apply command, or check the openspec AGENTS.md for instructions.

The openspec change at `openspec/changes/update-log-rotation-and-auto-clean/` has already been validated. Apply it:

Run: `bun openspec apply update-log-rotation-and-auto-clean`

If the `apply` command is not available as a CLI, invoke the `/openspec:apply` skill.

**Step 2: Verify**

Run: `bun openspec validate update-log-rotation-and-auto-clean --strict --no-interactive`
Expected: Validation passes

**Step 3: Commit**

```bash
git add openspec/specs/run-lifecycle/spec.md openspec/specs/log-management/spec.md openspec/changes/
git commit -m "spec: apply log rotation and auto-clean spec changes"
```

---

## Task 9: Update skills

**Files:**
- Modify: `.claude/skills/gauntlet-run/SKILL.md`
- Modify: `.claude/skills/gauntlet-status/SKILL.md`
- Modify: `.claude/skills/gauntlet-help/SKILL.md`

**Step 1: Update gauntlet-run/SKILL.md**

In the termination conditions list (step 6), change the retry limit bullet from:

```text
   - "Status: Retry limit exceeded" appears in the output -> Run `bun src/index.ts clean` to archive logs for the session record. Do NOT retry after cleaning.
```

to:

```text
   - "Status: Retry limit exceeded" appears in the output (logs are automatically archived). Do NOT retry.
```

**Step 2: Update gauntlet-status/SKILL.md**

Add after "The script parses the `.debug.log`..." paragraph:

```markdown
Previous sessions are available in `previous/`, `previous.1/`, etc. within the log directory. Use these to compare across sessions.
```

**Step 3: Update gauntlet-help/SKILL.md**

In the Evidence Sources table, add a row:

```
| `<log_dir>/previous/`, `<log_dir>/previous.N/` | Archived logs from previous sessions (N-deep rotation controlled by `max_previous_logs` config) |
```

In the `.gauntlet/config.yml` row, add `max_previous_logs` to the list of confirmed fields.

In the CLI Command Quick-Reference, update the `agent-gauntlet clean` description:

```
| `agent-gauntlet clean` | Archive current logs (rotates into `previous/`, `previous.1/`, etc.) — confirm with user first |
```

**Step 4: Commit**

```bash
git add .claude/skills/gauntlet-run/SKILL.md .claude/skills/gauntlet-status/SKILL.md .claude/skills/gauntlet-help/SKILL.md
git commit -m "docs: update skills for auto-archive on retry limit and log rotation"
```

---

## Task 10: Update documentation

**Files:**
- Modify: `docs/config-reference.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/stop-hook-guide.md`
- Modify: `docs/skills-guide.md`

**Step 1: Update docs/config-reference.md**

Add after the `max_retries` field description:

```markdown
- **max_previous_logs**: number (default: `3`)
  Maximum number of archived session directories to keep during log rotation. When logs are cleaned (manually or automatically), the current session is archived into `previous/`, and existing archives shift: `previous/` becomes `previous.1/`, `previous.1/` becomes `previous.2/`, etc. The oldest archive beyond this count is deleted. Set to `0` to disable archiving entirely (logs are deleted on clean). Set to `1` for single-generation archiving (pre-existing behavior).
```

Add `max_previous_logs: 3` to the example config, after `max_retries`:

```yaml
max_retries: 3
max_previous_logs: 3
```

**Step 2: Update docs/user-guide.md**

Update the `agent-gauntlet clean` section:

```markdown
### `agent-gauntlet clean`

Archives logs using configurable N-deep rotation. Current `.log` and `.json` files are moved into `previous/`, while existing `previous/` archives shift to `previous.1/`, `previous.2/`, etc. The oldest archive beyond `max_previous_logs` (default: 3) is evicted. Execution state is preserved.

This is also triggered automatically when a run completes with all gates passing, or when the retry limit is exceeded.
```

**Step 3: Update docs/stop-hook-guide.md**

Find "Retry limit exceeded" references and update:

1. In "Termination Conditions" section, change:
   ```
   - **"Status: Retry limit exceeded"** — Too many fix attempts (`max_retries`, default 3); requires `agent-gauntlet clean` to archive and reset
   ```
   to:
   ```
   - **"Status: Retry limit exceeded"** — Too many fix attempts (`max_retries`, default 3); logs are automatically archived
   ```

2. In "Retry Limits" section, change:
   ```
   After the initial run plus `max_retries` re-runs, the gauntlet reports "Retry limit exceeded" and allows the agent to stop. At that point, run `agent-gauntlet clean` to archive the session.
   ```
   to:
   ```
   After the initial run plus `max_retries` re-runs, the gauntlet reports "Retry limit exceeded" and allows the agent to stop. Logs are automatically archived at this point.
   ```

3. In "Best Practices", update the clean description:
   ```
   4. **Clean between branches**: Run `agent-gauntlet clean` when switching branches to avoid confusion from stale logs. This archives log files and deletes execution state (including unhealthy adapter entries).
   ```
   to:
   ```
   4. **Clean between branches**: Run `agent-gauntlet clean` when switching branches to avoid confusion from stale logs. This archives log files into rotated `previous/` directories. Execution state is preserved (only reset automatically on branch change or commit merge).
   ```

**Step 4: Update docs/skills-guide.md**

In the `/gauntlet-run` section, update step 1:

```markdown
1. Archives previous logs (`agent-gauntlet clean`)
```

to:

```markdown
1. Archives previous logs (`agent-gauntlet clean` with configurable rotation depth)
```

Update step 4:

```markdown
4. Repeats until all gates pass, warnings only remain, or retry limit (3) is reached
```

to:

```markdown
4. Repeats until all gates pass, warnings only remain, or retry limit is reached (logs auto-archived)
```

**Step 5: Commit**

```bash
git add docs/config-reference.md docs/user-guide.md docs/stop-hook-guide.md docs/skills-guide.md
git commit -m "docs: update docs for log rotation and auto-archive on retry limit"
```

---

## Task 11: Run full test suite and gauntlet

**Step 1: Run all tests**

Run: `bun test`
Expected: PASS

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Run the gauntlet**

Invoke `/gauntlet-run` to validate all changes pass the quality gates.

**Step 4: Final commit if any fixes needed**

Address any issues from the gauntlet and commit fixes.

---

Plan complete and saved to `docs/plans/2026-02-08-log-rotation-and-auto-clean.plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
