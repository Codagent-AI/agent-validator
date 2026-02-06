import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../src/config/loader.js";

const TEST_DIR = path.join(process.cwd(), `test-env-${Date.now()}`);
const GAUNTLET_DIR = path.join(TEST_DIR, ".gauntlet");
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
		expect(config.project.entry_points[0].path).toBe("src/");
	});

	it("should load check gates correctly", async () => {
		const config = await loadConfig(TEST_DIR);

		expect(Object.keys(config.checks)).toContain("lint");
		expect(config.checks.lint.command).toBe("npm run lint");
	});

	it("should load review gates correctly", async () => {
		const config = await loadConfig(TEST_DIR);

		expect(Object.keys(config.reviews)).toContain("security");
		expect(config.reviews.security.name).toBe("security");
		expect(config.reviews.security.cli_preference).toEqual(["gemini"]);
		expect(config.reviews.security.promptContent).toContain(
			"Check for vulnerabilities.",
		);
	});

	it("should merge default cli preference", async () => {
		const config = await loadConfig(TEST_DIR);

		expect(Object.keys(config.reviews)).toContain("style");
		expect(config.reviews.style.cli_preference).toEqual(["claude", "gemini"]);
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
		} catch {}

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
		expect(config.checks.valid.fail_fast).toBe(true);
		expect(config.checks.valid.parallel).toBe(false);
	});
});

describe("Built-in Reviews", () => {
	let tmpDir: string;

	async function setupTestEnv(configYml: string, reviewFiles?: Record<string, string>) {
		tmpDir = path.join(process.cwd(), `test-builtin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const gauntletDir = path.join(tmpDir, ".gauntlet");
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

	it("should load built-in:code-quality with expected prompt content and defaults", async () => {
		await setupTestEnv(`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - built-in:code-quality
`);
		const config = await loadConfig(tmpDir);

		const review = config.reviews["built-in:code-quality"];
		expect(review).toBeDefined();
		expect(review.promptContent).toContain("Bugs");
		expect(review.promptContent).toContain("Security");
		expect(review.promptContent).toContain("Maintainability");
		expect(review.promptContent).toContain("Performance");
		expect(review.num_reviews).toBe(1);
		expect(review.parallel).toBe(true);
		expect(review.run_in_ci).toBe(true);
		expect(review.run_locally).toBe(true);
	});

	it("should throw for unknown built-in name", async () => {
		await setupTestEnv(`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - built-in:nonexistent
`);
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			'Unknown built-in review: "nonexistent"',
		);
	});

	it("should allow user-defined review and built-in review to coexist", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - built-in:code-quality
      - my-custom-review
`,
			{
				"my-custom-review.md": `---
num_reviews: 2
---

# Custom Review
Custom prompt.
`,
			},
		);
		const config = await loadConfig(tmpDir);

		expect(config.reviews["built-in:code-quality"]).toBeDefined();
		expect(config.reviews["my-custom-review"]).toBeDefined();
		expect(config.reviews["my-custom-review"].num_reviews).toBe(2);
	});

	it("should apply CLI preference merging to built-in reviews", async () => {
		await setupTestEnv(`
base_branch: origin/main
cli:
  default_preference:
    - claude
    - gemini
entry_points:
  - path: "."
    reviews:
      - built-in:code-quality
`);
		const config = await loadConfig(tmpDir);

		expect(config.reviews["built-in:code-quality"].cli_preference).toEqual([
			"claude",
			"gemini",
		]);
	});

	it("should set isBuiltIn to true and prompt to built-in:code-quality", async () => {
		await setupTestEnv(`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - built-in:code-quality
`);
		const config = await loadConfig(tmpDir);

		const review = config.reviews["built-in:code-quality"];
		expect(review.isBuiltIn).toBe(true);
		expect(review.prompt).toBe("built-in:code-quality");
	});

	it("should allow user review named code-quality alongside built-in:code-quality", async () => {
		await setupTestEnv(
			`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - built-in:code-quality
      - code-quality
`,
			{
				"code-quality.md": `---
num_reviews: 3
---

# User Code Quality
User prompt.
`,
			},
		);
		const config = await loadConfig(tmpDir);

		expect(config.reviews["built-in:code-quality"]).toBeDefined();
		expect(config.reviews["code-quality"]).toBeDefined();
		expect(config.reviews["built-in:code-quality"].isBuiltIn).toBe(true);
		expect(config.reviews["code-quality"].isBuiltIn).toBeUndefined();
		expect(config.reviews["code-quality"].num_reviews).toBe(3);
	});

	it("should pass entry point validation with built-in:code-quality reference", async () => {
		await setupTestEnv(`
base_branch: origin/main
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - built-in:code-quality
`);
		// Should not throw
		const config = await loadConfig(tmpDir);
		expect(config.reviews["built-in:code-quality"]).toBeDefined();
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
      - built-in:code-quality
`,
			{
				"built-in:code-quality.md": `---
num_reviews: 1
---

# Fake built-in
`,
			},
		);
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			/reserved "built-in:" prefix/,
		);
	});
});
