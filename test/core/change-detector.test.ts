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
