import { afterAll, beforeAll, describe, expect, it } from "bun:test";
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
