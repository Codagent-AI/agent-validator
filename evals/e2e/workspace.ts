import { execFileSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildValidatorConfig } from "./config.js";
import type { E2EReviewerConfig } from "./types.js";

export interface Workspace {
	/** Temporary directory holding `repo/` and `bin/`. */
	root: string;
	repo: string;
	/** Prepended to the lead agent's PATH; holds the `agent-validate` shim. */
	binDir: string;
	/** Git tree of the feature as written, before the lead agent changes anything. */
	initialTree: string;
}

const GIT_IDENTITY = ["-c", "user.name=validator-e2e", "-c", "user.email=e2e@invalid"];

function git(repo: string, args: string[], env?: NodeJS.ProcessEnv): string {
	return execFileSync("git", [...GIT_IDENTITY, ...args], {
		cwd: repo,
		encoding: "utf-8",
		env: env ?? process.env,
		maxBuffer: 64 * 1024 * 1024,
	});
}

/**
 * Builds a repo the way a user would have it after an agent wrote a feature:
 * `main` holds the fixture's base code plus the validator config and skills,
 * and the fixture diff is applied as uncommitted changes on a `feature` branch.
 *
 * Workspaces live in the OS temp directory, outside this repository, so the
 * lead agent does not pick up this repository's CLAUDE.md files.
 */
export function createWorkspace(options: {
	fixtureDir: string;
	validatorRoot: string;
	reviewer: E2EReviewerConfig;
}): Workspace {
	const root = mkdtempSync(join(tmpdir(), "validator-e2e-"));
	const repo = join(root, "repo");
	const binDir = join(root, "bin");
	mkdirSync(repo);
	mkdirSync(binDir);

	writeValidatorShim(binDir, options.validatorRoot);
	cpSync(join(options.fixtureDir, "base"), repo, { recursive: true });
	mkdirSync(join(repo, ".validator"));
	writeFileSync(join(repo, ".validator", "config.yml"), buildValidatorConfig(options.reviewer));
	// Build artifacts a real project would ignore, so they do not show up as agent changes.
	writeFileSync(join(repo, ".gitignore"), "validator_logs\n__pycache__/\n*.pyc\nnode_modules/\ndist/\n");
	installSkills(join(options.validatorRoot, "skills"), join(repo, ".claude", "skills"));

	git(repo, ["init", "-q", "-b", "main"]);
	git(repo, ["add", "-A"]);
	// Force-add skills: a global gitignore may exclude `.claude/`.
	git(repo, ["add", "-f", ".claude"]);
	git(repo, ["commit", "-q", "-m", "base"]);
	git(repo, ["checkout", "-q", "-b", "feature"]);
	git(repo, ["apply", join(options.fixtureDir, "diff.patch")]);

	return { root, repo, binDir, initialTree: snapshotTree(repo, root) };
}

/** `agent-validate` resolves to this checkout's build, never one on PATH. */
function writeValidatorShim(binDir: string, validatorRoot: string): void {
	const entry = join(validatorRoot, "dist", "index.js");
	for (const name of ["agent-validate", "agent-validator"]) {
		const path = join(binDir, name);
		writeFileSync(path, `#!/bin/sh\nexec node "${entry}" "$@"\n`);
		chmodSync(path, 0o755);
	}
}

function installSkills(source: string, target: string): void {
	mkdirSync(target, { recursive: true });
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			cpSync(join(source, entry.name), join(target, entry.name), { recursive: true });
		}
	}
}

/** Writes the working tree to a git tree object without touching the real index. */
export function snapshotTree(repo: string, scratchDir: string): string {
	const indexFile = join(scratchDir, `snapshot-${Date.now()}.index`);
	const env = { ...process.env, GIT_INDEX_FILE: indexFile };
	try {
		git(repo, ["add", "-A"], env);
		return git(repo, ["write-tree"], env).trim();
	} finally {
		rmSync(indexFile, { force: true });
	}
}

/** Diff between two trees, limited to source the lead agent could change. */
export function diffTrees(repo: string, from: string, to: string): string {
	return git(repo, ["diff", from, to, "--", ".", ":(exclude).validator", ":(exclude).claude"]);
}

/** Files changed between two trees. */
export function changedFiles(repo: string, from: string, to: string): string[] {
	return git(repo, ["diff", "--name-only", from, to, "--", ".", ":(exclude).validator", ":(exclude).claude"])
		.split("\n")
		.filter(Boolean);
}
