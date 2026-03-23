import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../src/config/loader.js";

const TEST_DIR = path.join(process.cwd(), `test-env-${Date.now()}`);
const GAUNTLET_DIR = path.join(TEST_DIR, ".validator");
const CHECKS_DIR = path.join(GAUNTLET_DIR, "checks");
const REVIEWS_DIR = path.join(GAUNTLET_DIR, "reviews");

describe("Config Loader", () => {
	beforeAll(async () => {
		// Setup directory structure
		await fs.mkdir(TEST_DIR);
		await fs.mkdir(GAUNTLET_DIR);
		await fs.mkdir(CHECKS_DIR);
		await fs.mkdir(REVIEWS_DIR);

		// Write config.yml
		await fs.writeFile(
			path.join(GAUNTLET_DIR, "config.yml"),
			`
base_branch: origin/dev
log_dir: test_logs
cli:
  default_preference:
    - claude
    - gemini
entry_points:
  - path: src/
    checks:
      - lint
    reviews:
      - security
`,
		);

		// Write a check definition
		await fs.writeFile(
			path.join(CHECKS_DIR, "lint.yml"),
			`
name: lint
command: npm run lint
working_directory: .
`,
		);

		// Write a review definition
		await fs.writeFile(
			path.join(REVIEWS_DIR, "security.md"),
			`---
cli_preference:
  - gemini
---

# Security Review
Check for vulnerabilities.
`,
		);

		// Write a review definition without preference
		await fs.writeFile(
			path.join(REVIEWS_DIR, "style.md"),
			`---
num_reviews: 1
---

# Style Review
Check style.
`,
		);
	});

	afterAll(async () => {
		// Cleanup
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("should load project configuration correctly", async () => {
		const config = await loadConfig(TEST_DIR);

		expect(config.project.base_branch).toBe("origin/dev");
		expect(config.project.log_dir).toBe("test_logs");
		expect(config.project.entry_points).toHaveLength(1);
		expect(config.project.entry_points[0]!.path).toBe("src/");
	});

	it("should load check gates correctly", async () => {
		const config = await loadConfig(TEST_DIR);

		expect(Object.keys(config.checks)).toContain("lint");
		expect(config.checks.lint!.command).toBe("npm run lint");
	});

	it("should load review gates correctly", async () => {
		const config = await loadConfig(TEST_DIR);

		expect(Object.keys(config.reviews)).toContain("security");
		expect(config.reviews.security!.name).toBe("security");
		expect(config.reviews.security!.cli_preference).toEqual(["gemini"]);
		expect(config.reviews.security!.promptContent).toContain(
			"Check for vulnerabilities.",
		);
	});

	it("should merge default cli preference", async () => {
		const config = await loadConfig(TEST_DIR);

		expect(Object.keys(config.reviews)).toContain("style");
		expect(config.reviews.style!.cli_preference).toEqual(["claude", "gemini"]);
	});

	it("should reject check gate with fail_fast when parallel is true", async () => {
		await fs.writeFile(
			path.join(CHECKS_DIR, "invalid.yml"),
			`
name: invalid
command: echo test
parallel: true
fail_fast: true
`,
		);

		await expect(loadConfig(TEST_DIR)).rejects.toThrow(
			/fail_fast can only be used when parallel is false/,
		);
	});

	it("should accept check gate with fail_fast when parallel is false", async () => {
		// Clean up the invalid file first
		try {
			await fs.unlink(path.join(CHECKS_DIR, "invalid.yml"));
		} catch { }

		await fs.writeFile(
			path.join(CHECKS_DIR, "valid.yml"),
			`
name: valid
command: echo test
parallel: false
fail_fast: true
`,
		);

		const config = await loadConfig(TEST_DIR);
		expect(config.checks.valid).toBeDefined();
		expect(config.checks.valid!.fail_fast).toBe(true);
		expect(config.checks.valid!.parallel).toBe(false);
	});
});

describe("Built-in Reviews (YAML builtin attribute)", () => {
	let tmpDir: string;

	async function setupTestEnv(configYml: string, reviewFiles?: Record<string, string>) {
		tmpDir = path.join(process.cwd(), `test-builtin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const gauntletDir = path.join(tmpDir, ".validator");
		const reviewsDir = path.join(gauntletDir, "reviews");

		await fs.mkdir(tmpDir);
		await fs.mkdir(gauntletDir);
		await fs.mkdir(reviewsDir);
		await fs.writeFile(path.join(gauntletDir, "config.yml"), configYml);

		if (reviewFiles) {
			for (const [name, content] of Object.entries(reviewFiles)) {
				await fs.writeFile(path.join(reviewsDir, name), content);
			}
		}

		return tmpDir;
	}

	afterEach(async () => {
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("should load YAML review with builtin: code-quality successfully", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - code-quality
`,
			{
				"code-quality.yml": `builtin: code-quality\nnum_reviews: 2\n`,
			},
		);
		const config = await loadConfig(tmpDir);

		const review = config.reviews["code-quality"];
		expect(review).toBeDefined();
		expect(review!.promptContent).toContain("code-reviewer");
		expect(review!.promptContent).toContain("silent-failure-hunter");
		expect(review!.promptContent).toContain("type-design-analyzer");
		expect(review!.num_reviews).toBe(2);
	});

	async function setupSingleReviewEnv(yamlContent: string) {
		return setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - my-review
`,
			{ "my-review.yml": yamlContent },
		);
	}

	it("should throw for unknown builtin name", async () => {
		await setupSingleReviewEnv("builtin: nonexistent\n");
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			'Unknown built-in review: "nonexistent"',
		);
	});

	it("should reject YAML review with both builtin and prompt_file", async () => {
		await setupSingleReviewEnv("builtin: code-quality\nprompt_file: reviews/custom.md\n");
		await expect(loadConfig(tmpDir)).rejects.toThrow(/mutually exclusive/);
	});

	it("should reject YAML review with both builtin and skill_name", async () => {
		await setupSingleReviewEnv("builtin: code-quality\nskill_name: my-skill\n");
		await expect(loadConfig(tmpDir)).rejects.toThrow(/mutually exclusive/);
	});

	it("should use schema defaults when builtin review has no other settings", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - minimal
`,
			{
				"minimal.yml": `builtin: code-quality\n`,
			},
		);
		const config = await loadConfig(tmpDir);

		const review = config.reviews.minimal;
		expect(review).toBeDefined();
		expect(review!.num_reviews).toBe(1);
		expect(review!.parallel).toBe(true);
		expect(review!.run_in_ci).toBe(true);
		expect(review!.run_locally).toBe(true);
	});

	it("should allow user-defined .md review and YAML builtin review to coexist", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - my-builtin
      - my-custom
`,
			{
				"my-builtin.yml": `builtin: code-quality\n`,
				"my-custom.md": `---\nnum_reviews: 3\n---\n\n# Custom Review\nCustom prompt.\n`,
			},
		);
		const config = await loadConfig(tmpDir);

		expect(config.reviews["my-builtin"]).toBeDefined();
		expect(config.reviews["my-builtin"]!.promptContent).toContain("code-reviewer");
		expect(config.reviews["my-custom"]).toBeDefined();
		expect(config.reviews["my-custom"]!.num_reviews).toBe(3);
	});

	it("should apply CLI preference merging to YAML builtin reviews", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
    - gemini
entry_points:
  - path: "."
    reviews:
      - code-quality
`,
			{
				"code-quality.yml": `builtin: code-quality\n`,
			},
		);
		const config = await loadConfig(tmpDir);

		expect(config.reviews["code-quality"]!.cli_preference).toEqual([
			"claude",
			"gemini",
		]);
	});

	it("should load built-in prompt with pr-review-toolkit agent instructions and fallback", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - code-quality
`,
			{
				"code-quality.yml": `builtin: code-quality\n`,
			},
		);
		const config = await loadConfig(tmpDir);
		const content = config.reviews["code-quality"]!.promptContent!;

		// Pure markdown — no frontmatter delimiters
		expect(content).not.toMatch(/^---/);

		// Primary path: pr-review-toolkit agent instructions
		expect(content).toContain("code-reviewer");
		expect(content).toContain("silent-failure-hunter");
		expect(content).toContain("type-design-analyzer");

		// Fallback path: inline review framework covering three lenses
		expect(content).toMatch(/bug|security|logic error/i);
		expect(content).toMatch(/silent fail|swallowed error|error handling/i);
		expect(content).toMatch(/type design|type invariant|encapsulation/i);

		// Should NOT contain project-specific documentation references
		expect(content).not.toContain("docs/");
	});

	it("should instruct reviewer to use available agents and fall back for missing ones", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - code-quality
`,
			{
				"code-quality.yml": `builtin: code-quality\n`,
			},
		);
		const config = await loadConfig(tmpDir);
		const content = config.reviews["code-quality"]!.promptContent!;

		// Partial availability: use available agents, fall back for missing
		expect(content).toMatch(/available|unavailable|not available|fall\s?back/i);
	});

	it("should reject user-defined review file with built-in: prefix in filename", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - test
`,
			{
				"built-in:code-quality.md": `---\nnum_reviews: 1\n---\n\n# Fake built-in\n`,
				"test.yml": `builtin: code-quality\n`,
			},
		);
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			/reserved "built-in:" prefix/,
		);
	});

	it("should default enabled to true for YAML review with only builtin", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - code-quality
`,
			{
				"code-quality.yml": `builtin: code-quality\n`,
			},
		);
		const config = await loadConfig(tmpDir);
		expect(config.reviews["code-quality"]!.enabled).toBe(true);
	});

	it("should propagate enabled: false from YAML review", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - task-compliance
`,
			{
				"task-compliance.yml": `builtin: code-quality\nenabled: false\n`,
			},
		);
		const config = await loadConfig(tmpDir);
		expect(config.reviews["task-compliance"]!.enabled).toBe(false);
	});

	it("should propagate enabled: false from markdown review frontmatter", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - task-compliance
`,
			{
				"task-compliance.md": `---\nenabled: false\n---\n\n# Task Compliance\nCheck task adherence.\n`,
			},
		);
		const config = await loadConfig(tmpDir);
		expect(config.reviews["task-compliance"]!.enabled).toBe(false);
	});
});
