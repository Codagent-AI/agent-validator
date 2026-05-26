import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

async function readSetupSkill(): Promise<string> {
	return fs.readFile(
		path.join(process.cwd(), "skills", "validator-setup", "SKILL.md"),
		"utf-8",
	);
}

describe("validator-setup skill", () => {
	it("does not treat an init-created .validator directory as an existing setup", async () => {
		const skill = await readSetupSkill();

		expect(skill).toContain("git status --porcelain -- .validator");
		expect(skill).toContain(
			"treat this as a fresh install even though the directory exists",
		);
		expect(skill).toContain(
			"Do not conclude \"nothing to do\" or \"already set up\" merely because `.validator/` exists",
		);
	});
});
