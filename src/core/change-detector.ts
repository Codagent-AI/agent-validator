import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ChangeDetectorOptions {
	commit?: string; // If provided, get diff for this commit vs its parent
	uncommitted?: boolean; // If true, only get uncommitted changes (staged + unstaged)
	fixBase?: string; // If provided, get diff from this ref to current working tree
}

export class ChangeDetector {
	constructor(
		private baseBranch: string = "origin/main",
		private options: ChangeDetectorOptions = {},
	) {}

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

	private async getCIChangedFiles(): Promise<string[]> {
		// In GitHub Actions, GITHUB_SHA is the commit being built
		// Base branch priority is already resolved by caller
		const baseRef = this.baseBranch;
		const headRef = process.env.GITHUB_SHA || "HEAD";

		// We might need to fetch first in some shallow clones, but assuming strictly for now
		// git diff --name-only base...head
		try {
			const { stdout } = await execAsync(
				`git diff --name-only ${baseRef}...${headRef}`,
			);
			return this.parseOutput(stdout);
		} catch (error) {
			console.warn(
				"Failed to detect changes via git diff in CI, falling back to HEAD^...HEAD",
				error,
			);
			// Fallback for push events where base ref might not be available
			const { stdout } = await execAsync("git diff --name-only HEAD^...HEAD");
			return this.parseOutput(stdout);
		}
	}

	private async getLocalChangedFiles(): Promise<string[]> {
		// 1. Committed changes relative to base branch
		const { stdout: committed } = await execAsync(
			`git diff --name-only ${this.baseBranch}...HEAD`,
		);

		// 2. Uncommitted changes (staged and unstaged)
		const { stdout: uncommitted } = await execAsync(
			"git diff --name-only HEAD",
		);

		// 3. Untracked files
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

	private async getCommitChangedFiles(commit: string): Promise<string[]> {
		// Get diff for commit vs its parent
		try {
			const { stdout } = await execAsync(
				`git diff --name-only ${commit}^..${commit}`,
			);
			return this.parseOutput(stdout);
		} catch (_error) {
			// If commit has no parent (initial commit), just get files in that commit
			try {
				const { stdout } = await execAsync(
					`git diff --name-only --root ${commit}`,
				);
				return this.parseOutput(stdout);
			} catch {
				throw new Error(`Failed to get changes for commit ${commit}`);
			}
		}
	}

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

	private async getUncommittedChangedFiles(): Promise<string[]> {
		// Get uncommitted changes (staged + unstaged) and untracked files
		const { stdout: staged } = await execAsync("git diff --name-only --cached");
		const { stdout: unstaged } = await execAsync("git diff --name-only");
		const { stdout: untracked } = await execAsync(
			"git ls-files --others --exclude-standard",
		);

		const files = new Set([
			...this.parseOutput(staged),
			...this.parseOutput(unstaged),
			...this.parseOutput(untracked),
		]);

		return Array.from(files);
	}

	private parseOutput(stdout: string): string[] {
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}
}
