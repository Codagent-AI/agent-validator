import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ChangeDetector } from "../../src/core/change-detector.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd });
	return stdout.trim();
}

describe("ChangeDetector fixBase support", () => {
	it("uses fixBase when provided and no commit/uncommitted set", async () => {
		const fixBase = "abc123def456";
		const detector = new ChangeDetector("origin/main", { fixBase });
		const spy = spyOn(
			detector as any,
			"getFixBaseChangedFiles",
		).mockResolvedValue(["src/foo.ts"]);

		const files = await detector.getChangedFiles();
		expect(spy).toHaveBeenCalledWith(fixBase);
		expect(files).toEqual(["src/foo.ts"]);
		spy.mockRestore();
	});

	it("explicit commit overrides fixBase", async () => {
		const commit = "abc123";
		const fixBase = "def456";
		const detector = new ChangeDetector("origin/main", { commit, fixBase });
		const commitSpy = spyOn(
			detector as any,
			"getCommitChangedFiles",
		).mockResolvedValue(["src/bar.ts"]);
		const fixBaseSpy = spyOn(
			detector as any,
			"getFixBaseChangedFiles",
		).mockResolvedValue(["src/foo.ts"]);

		const files = await detector.getChangedFiles();
		expect(commitSpy).toHaveBeenCalledWith(commit);
		expect(fixBaseSpy).not.toHaveBeenCalled();
		expect(files).toEqual(["src/bar.ts"]);
		commitSpy.mockRestore();
		fixBaseSpy.mockRestore();
	});

	it("fixBase overrides uncommitted when both are set", async () => {
		const fixBase = "def456";
		const detector = new ChangeDetector("origin/main", {
			uncommitted: true,
			fixBase,
		});
		const fixBaseSpy = spyOn(
			detector as any,
			"getFixBaseChangedFiles",
		).mockResolvedValue(["src/foo.ts"]);
		const uncommittedSpy = spyOn(
			detector as any,
			"getUncommittedChangedFiles",
		).mockResolvedValue(["src/baz.ts"]);

		const files = await detector.getChangedFiles();
		expect(fixBaseSpy).toHaveBeenCalledWith(fixBase);
		expect(uncommittedSpy).not.toHaveBeenCalled();
		expect(files).toEqual(["src/foo.ts"]);
		fixBaseSpy.mockRestore();
		uncommittedSpy.mockRestore();
	});

	it("rejects refs starting with a hyphen", async () => {
		const detector = new ChangeDetector("origin/main", { fixBase: "--help" });
		await expect(detector.getChangedFiles()).rejects.toThrow("Invalid fixBase ref");
	});

	it("rejects commit refs starting with a hyphen", async () => {
		const detector = new ChangeDetector("origin/main", { commit: "-x" });
		await expect(detector.getChangedFiles()).rejects.toThrow("Invalid commit ref");
	});

	it("priority order: commit > fixBase > uncommitted > default", () => {
		const { readFileSync } = require("node:fs");
		const { join } = require("node:path");
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/change-detector.ts"),
			"utf-8",
		);

		const commitCheck = sourceFile.indexOf("this.options.commit");
		const fixBaseCheck = sourceFile.indexOf("this.options.fixBase");
		const uncommittedCheck = sourceFile.indexOf("this.options.uncommitted");

		expect(commitCheck).toBeGreaterThan(-1);
		expect(fixBaseCheck).toBeGreaterThan(-1);
		expect(uncommittedCheck).toBeGreaterThan(-1);

		expect(commitCheck).toBeLessThan(fixBaseCheck);
		expect(fixBaseCheck).toBeLessThan(uncommittedCheck);
	});
});

describe("ChangeDetector fixBase dirty snapshots", () => {
	let repoDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		originalCwd = process.cwd();
		repoDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "validator-change-detector-"),
		);
		await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
		await git(["config", "user.email", "test@example.com"], repoDir);
		await git(["config", "user.name", "Test User"], repoDir);
		await fs.writeFile(path.join(repoDir, "tracked.ts"), "export const a = 1;\n");
		await git(["add", "tracked.ts"], repoDir);
		await git(["commit", "-m", "base"], repoDir);
		process.chdir(repoDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await fs.rm(repoDir, { recursive: true, force: true });
	});

	async function createDirtySnapshot(): Promise<string> {
		await fs.writeFile(path.join(repoDir, "tracked.ts"), "export const a = 2;\n");
		await fs.writeFile(
			path.join(repoDir, "untracked.ts"),
			"export const b = 1;\n",
		);

		await git(["stash", "push", "--include-untracked", "-m", "snapshot"], repoDir);
		const fixBase = await git(["rev-parse", "stash@{0}"], repoDir);
		await git(["stash", "pop"], repoDir);
		return fixBase;
	}

	it("reports no changes when the dirty working tree still matches the fixBase snapshot", async () => {
		const fixBase = await createDirtySnapshot();

		const detector = new ChangeDetector("main", { fixBase });

		await expect(detector.getChangedFiles()).resolves.toEqual([]);
	});

	it("reports tracked files changed after the fixBase snapshot", async () => {
		const fixBase = await createDirtySnapshot();
		await fs.writeFile(path.join(repoDir, "tracked.ts"), "export const a = 3;\n");

		const detector = new ChangeDetector("main", { fixBase });

		await expect(detector.getChangedFiles()).resolves.toEqual(["tracked.ts"]);
	});

	it("reports untracked files changed after the fixBase snapshot", async () => {
		const fixBase = await createDirtySnapshot();
		await fs.writeFile(
			path.join(repoDir, "untracked.ts"),
			"export const b = 2;\n",
		);

		const detector = new ChangeDetector("main", { fixBase });

		await expect(detector.getChangedFiles()).resolves.toEqual(["untracked.ts"]);
	});
});
