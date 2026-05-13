import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

async function readSkill(name: string): Promise<string> {
	return fs.readFile(path.join(process.cwd(), "skills", name, "SKILL.md"), "utf-8");
}

describe("validator skill invocation policy", () => {
	it("allows model invocation for explicit full validator requests only", async () => {
		const skill = await readSkill("validator-run");

		expect(skill).toContain("disable-model-invocation: false");
		expect(skill).toContain("Activates only for explicit full-validator requests");
		expect(skill).toContain("run the gauntlet");
		expect(skill).toContain("Do not choose this skill merely because a coding task was completed");
	});

	it("allows model invocation for explicit checks-only requests", async () => {
		const skill = await readSkill("validator-check");

		expect(skill).toContain("disable-model-invocation: false");
		expect(skill).toContain("checks only");
		expect(skill).toContain("without AI reviews");
		expect(skill).toContain('Do not choose this skill for generic "run the validator"');
	});

	it("restricts validator commit to validator-aware commit requests", async () => {
		const skill = await readSkill("validator-commit");

		expect(skill).toContain("disable-model-invocation: false");
		expect(skill).toContain("Excludes plain commit requests");
		expect(skill).toContain("Do not choose this skill for a plain \"commit\"");
		expect(skill.indexOf('Contains "check" or "checks"')).toBeLessThan(
			skill.indexOf('Contains "run", "full", or "all gates"'),
		);
	});
});
