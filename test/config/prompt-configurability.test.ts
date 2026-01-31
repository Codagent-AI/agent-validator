import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../src/config/loader.js";

const TEST_DIR = path.join(process.cwd(), `test-prompt-config-${Date.now()}`);
const GAUNTLET_DIR = path.join(TEST_DIR, ".gauntlet");
const CHECKS_DIR = path.join(GAUNTLET_DIR, "checks");
const REVIEWS_DIR = path.join(GAUNTLET_DIR, "reviews");
const PROMPTS_DIR = path.join(GAUNTLET_DIR, "prompts");

async function writeConfig(entryChecks: string[], entryReviews: string[]) {
	const checksSection =
		entryChecks.length > 0
			? `    checks:\n${entryChecks.map((c) => `      - ${c}`).join("\n")}\n`
			: "";
	const reviewsSection =
		entryReviews.length > 0
			? `    reviews:\n${entryReviews.map((r) => `      - ${r}`).join("\n")}\n`
			: "";
	await fs.writeFile(
		path.join(GAUNTLET_DIR, "config.yml"),
		`base_branch: origin/main
log_dir: test_logs
cli:
  default_preference:
    - claude
    - gemini
entry_points:
  - path: src/
${checksSection}${reviewsSection}`,
	);
}

async function setupBase(checks: string[] = [], reviews: string[] = []) {
	await fs.rm(TEST_DIR, { recursive: true, force: true });
	await fs.mkdir(TEST_DIR, { recursive: true });
	await fs.mkdir(GAUNTLET_DIR);
	await fs.mkdir(CHECKS_DIR);
	await fs.mkdir(REVIEWS_DIR);
	await fs.mkdir(PROMPTS_DIR, { recursive: true });
	await writeConfig(checks, reviews);
}

describe("Prompt Configurability", () => {
	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	// ── YAML review with prompt_file ──────────────────────────────
	describe("YAML review with prompt_file", () => {
		beforeAll(async () => {
			await setupBase([], ["security"]);
			await fs.writeFile(
				path.join(PROMPTS_DIR, "security-review.md"),
				"Review for security vulnerabilities.",
			);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "security.yml"),
				`prompt_file: prompts/security-review.md
cli_preference:
  - claude
`,
			);
		});

		it("loads content from external file", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.reviews.security).toBeDefined();
			expect(config.reviews.security.promptContent).toBe(
				"Review for security vulnerabilities.",
			);
			expect(config.reviews.security.skillName).toBeUndefined();
		});
	});

	// ── YAML review with skill_name ──────────────────────────────
	describe("YAML review with skill_name", () => {
		beforeAll(async () => {
			await setupBase([], ["code-quality"]);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "code-quality.yml"),
				`skill_name: code-review
num_reviews: 2
`,
			);
		});

		it("sets skillName and no promptContent", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.reviews["code-quality"]).toBeDefined();
			expect(config.reviews["code-quality"].skillName).toBe("code-review");
			expect(config.reviews["code-quality"].promptContent).toBeUndefined();
			expect(config.reviews["code-quality"].num_reviews).toBe(2);
		});
	});

	// ── YAML review rejects both prompt_file and skill_name ──────
	describe("YAML review rejects both prompt_file and skill_name", () => {
		beforeAll(async () => {
			await setupBase([], ["invalid"]);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "invalid.yml"),
				`prompt_file: prompts/foo.md
skill_name: some-skill
`,
			);
		});

		it("throws validation error", async () => {
			await expect(loadConfig(TEST_DIR)).rejects.toThrow(/mutually exclusive/);
		});
	});

	// ── YAML review rejects neither prompt_file nor skill_name ───
	describe("YAML review rejects neither prompt_file nor skill_name", () => {
		beforeAll(async () => {
			await setupBase([], ["empty"]);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "empty.yml"),
				`num_reviews: 1
`,
			);
		});

		it("throws validation error", async () => {
			await expect(loadConfig(TEST_DIR)).rejects.toThrow(
				/must specify exactly one/,
			);
		});
	});

	// ── MD review with prompt_file in frontmatter overrides body ─
	describe("MD review with prompt_file in frontmatter", () => {
		beforeAll(async () => {
			await setupBase([], ["security"]);
			await fs.writeFile(
				path.join(PROMPTS_DIR, "shared.md"),
				"Shared prompt content.",
			);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "security.md"),
				`---
prompt_file: prompts/shared.md
---

This body should be overridden.
`,
			);
		});

		it("loads content from prompt_file, not body", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.reviews.security.promptContent).toBe(
				"Shared prompt content.",
			);
		});
	});

	// ── MD review with skill_name in frontmatter ─────────────────
	describe("MD review with skill_name in frontmatter", () => {
		beforeAll(async () => {
			await setupBase([], ["security"]);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "security.md"),
				`---
skill_name: my-skill
---

This body should be ignored.
`,
			);
		});

		it("sets skillName and no promptContent", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.reviews.security.skillName).toBe("my-skill");
			expect(config.reviews.security.promptContent).toBeUndefined();
		});
	});

	// ── MD review rejects both prompt_file and skill_name ────────
	describe("MD review rejects both prompt_file and skill_name", () => {
		beforeAll(async () => {
			await setupBase([], ["invalid"]);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "invalid.md"),
				`---
prompt_file: foo.md
skill_name: some-skill
---

Body.
`,
			);
		});

		it("throws validation error", async () => {
			await expect(loadConfig(TEST_DIR)).rejects.toThrow(/mutually exclusive/);
		});
	});

	// ── Check valid definition (filename-derived name) ───────────
	describe("Check valid definition", () => {
		beforeAll(async () => {
			await setupBase(["my-check"], []);
			await fs.writeFile(
				path.join(CHECKS_DIR, "my-check.yml"),
				`command: "echo hello"
`,
			);
		});

		it("derives name from filename", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.checks["my-check"]).toBeDefined();
			expect(config.checks["my-check"].name).toBe("my-check");
			expect(config.checks["my-check"].command).toBe("echo hello");
		});
	});

	// ── Check with name attribute is ignored ─────────────────────
	describe("Check with name attribute is ignored", () => {
		beforeAll(async () => {
			await setupBase(["legacy"], []);
			await fs.writeFile(
				path.join(CHECKS_DIR, "legacy.yml"),
				`name: "wrong-name"
command: "true"
`,
			);
		});

		it("identifies check by filename, not name attribute", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.checks.legacy).toBeDefined();
			expect(config.checks.legacy.name).toBe("legacy");
		});
	});

	// ── Check with fix_instructions_file loads content ────────────
	describe("Check with fix_instructions_file", () => {
		beforeAll(async () => {
			await setupBase(["lint"], []);
			const fixDir = path.join(GAUNTLET_DIR, "fix-guides");
			await fs.mkdir(fixDir, { recursive: true });
			await fs.writeFile(
				path.join(fixDir, "lint.md"),
				"Run `bun run lint --fix` to auto-fix.",
			);
			await fs.writeFile(
				path.join(CHECKS_DIR, "lint.yml"),
				`command: bun run lint
fix_instructions_file: fix-guides/lint.md
`,
			);
		});

		it("loads fix instructions content", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.checks.lint.fixInstructionsContent).toBe(
				"Run `bun run lint --fix` to auto-fix.",
			);
		});
	});

	// ── Check with deprecated fix_instructions alias ─────────────
	describe("Check with deprecated fix_instructions alias", () => {
		beforeAll(async () => {
			await setupBase(["lint"], []);
			const fixDir = path.join(GAUNTLET_DIR, "fix-guides");
			await fs.mkdir(fixDir, { recursive: true });
			await fs.writeFile(
				path.join(fixDir, "lint.md"),
				"Fix instructions via deprecated field.",
			);
			await fs.writeFile(
				path.join(CHECKS_DIR, "lint.yml"),
				`command: bun run lint
fix_instructions: fix-guides/lint.md
`,
			);
		});

		it("treats fix_instructions as alias for fix_instructions_file", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.checks.lint.fixInstructionsContent).toBe(
				"Fix instructions via deprecated field.",
			);
		});
	});

	// ── Check with fix_with_skill ────────────────────────────────
	describe("Check with fix_with_skill", () => {
		beforeAll(async () => {
			await setupBase(["test"], []);
			await fs.writeFile(
				path.join(CHECKS_DIR, "test.yml"),
				`command: bun test
fix_with_skill: fix-tests
`,
			);
		});

		it("stores skill name", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.checks.test.fixWithSkill).toBe("fix-tests");
			expect(config.checks.test.fixInstructionsContent).toBeUndefined();
		});
	});

	// ── Check rejects fix_instructions_file + fix_with_skill ─────
	describe("Check rejects fix_instructions_file + fix_with_skill", () => {
		beforeAll(async () => {
			await setupBase(["bad"], []);
			await fs.writeFile(
				path.join(CHECKS_DIR, "bad.yml"),
				`command: echo test
fix_instructions_file: fix.md
fix_with_skill: fix-it
`,
			);
		});

		it("throws mutual exclusivity error", async () => {
			await expect(loadConfig(TEST_DIR)).rejects.toThrow(/mutually exclusive/);
		});
	});

	// ── Check rejects fix_instructions + fix_instructions_file ───
	describe("Check rejects fix_instructions + fix_instructions_file", () => {
		beforeAll(async () => {
			await setupBase(["bad"], []);
			await fs.writeFile(
				path.join(CHECKS_DIR, "bad.yml"),
				`command: echo test
fix_instructions: old.md
fix_instructions_file: new.md
`,
			);
		});

		it("throws deprecation conflict error", async () => {
			await expect(loadConfig(TEST_DIR)).rejects.toThrow(/Cannot specify both/);
		});
	});

	// ── Absolute path works with warning ─────────────────────────
	describe("Absolute path works with warning", () => {
		let absFile: string;

		beforeAll(async () => {
			await setupBase([], ["abs-review"]);
			absFile = path.join(TEST_DIR, "absolute-prompt.md");
			await fs.writeFile(absFile, "Absolute path prompt content.");
		});

		it("loads from absolute path", async () => {
			await fs.writeFile(
				path.join(REVIEWS_DIR, "abs-review.yml"),
				`prompt_file: ${absFile}
`,
			);
			const config = await loadConfig(TEST_DIR);
			expect(config.reviews["abs-review"].promptContent).toBe(
				"Absolute path prompt content.",
			);
		});
	});

	// ── Missing prompt file throws error ─────────────────────────
	describe("Missing prompt file throws error", () => {
		beforeAll(async () => {
			await setupBase([], ["missing"]);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "missing.yml"),
				`prompt_file: nonexistent.md
`,
			);
		});

		it("throws file-not-found error", async () => {
			await expect(loadConfig(TEST_DIR)).rejects.toThrow(/not found/i);
		});
	});

	// ── Duplicate review name throws error ───────────────────────
	describe("Duplicate review name throws error", () => {
		beforeAll(async () => {
			await setupBase([], ["security"]);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "security.md"),
				`---
num_reviews: 1
---

MD review.
`,
			);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "security.yml"),
				`skill_name: sec-skill
`,
			);
		});

		it("throws duplicate name error", async () => {
			await expect(loadConfig(TEST_DIR)).rejects.toThrow(
				/duplicate review name/i,
			);
		});
	});

	// ── MD review without prompt_file or skill_name uses inline body ─
	describe("MD review without prompt_file or skill_name (backward compat)", () => {
		beforeAll(async () => {
			await setupBase([], ["inline-review"]);
			await fs.writeFile(
				path.join(REVIEWS_DIR, "inline-review.md"),
				`---
num_reviews: 1
---

Review the code for inline body content.
`,
			);
		});

		it("uses markdown body as promptContent", async () => {
			const config = await loadConfig(TEST_DIR);
			expect(config.reviews["inline-review"]).toBeDefined();
			expect(config.reviews["inline-review"].promptContent).toContain(
				"Review the code for inline body content.",
			);
			expect(config.reviews["inline-review"].skillName).toBeUndefined();
		});
	});
});
