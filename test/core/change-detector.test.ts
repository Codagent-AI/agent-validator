import { describe, expect, it, spyOn } from "bun:test";
import { ChangeDetector } from "../../src/core/change-detector.js";

describe("ChangeDetector fixBase support", () => {
	it("uses fixBase when provided and no commit/uncommitted set", async () => {
		const fixBase = "abc123def456";
		const detector = new ChangeDetector("origin/main", { fixBase });
		const spy = spyOn(
			detector as any,
			"getDiffWithWorkingTree",
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
			"getDiffWithWorkingTree",
		).mockResolvedValue(["src/foo.ts"]);

		const files = await detector.getChangedFiles();
		expect(commitSpy).toHaveBeenCalledWith(commit);
		expect(fixBaseSpy).not.toHaveBeenCalled();
		expect(files).toEqual(["src/bar.ts"]);
		commitSpy.mockRestore();
		fixBaseSpy.mockRestore();
	});

	it("explicit uncommitted overrides fixBase", async () => {
		const fixBase = "def456";
		const detector = new ChangeDetector("origin/main", {
			uncommitted: true,
			fixBase,
		});
		const uncommittedSpy = spyOn(
			detector as any,
			"getUncommittedChangedFiles",
		).mockResolvedValue(["src/baz.ts"]);
		const fixBaseSpy = spyOn(
			detector as any,
			"getDiffWithWorkingTree",
		).mockResolvedValue(["src/foo.ts"]);

		const files = await detector.getChangedFiles();
		expect(uncommittedSpy).toHaveBeenCalled();
		expect(fixBaseSpy).not.toHaveBeenCalled();
		expect(files).toEqual(["src/baz.ts"]);
		uncommittedSpy.mockRestore();
		fixBaseSpy.mockRestore();
	});

	it("priority order: commit > uncommitted > fixBase > default", () => {
		const { readFileSync } = require("node:fs");
		const { join } = require("node:path");
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/change-detector.ts"),
			"utf-8",
		);

		const commitCheck = sourceFile.indexOf("this.options.commit");
		const uncommittedCheck = sourceFile.indexOf("this.options.uncommitted");
		const fixBaseCheck = sourceFile.indexOf("this.options.fixBase");

		expect(commitCheck).toBeGreaterThan(-1);
		expect(uncommittedCheck).toBeGreaterThan(-1);
		expect(fixBaseCheck).toBeGreaterThan(-1);

		expect(commitCheck).toBeLessThan(uncommittedCheck);
		expect(uncommittedCheck).toBeLessThan(fixBaseCheck);
	});
});
