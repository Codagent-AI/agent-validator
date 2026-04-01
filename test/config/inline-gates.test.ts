import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../src/config/loader.js";

describe("Inline Gate Configs", () => {
	let tmpDir: string;

	async function setupTestEnv(opts: {
		configYml: string;
		checkFiles?: Record<string, string>;
		reviewFiles?: Record<string, string>;
	}) {
		tmpDir = path.join(
			process.cwd(),
			`test-inline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		const gauntletDir = path.join(tmpDir, ".validator");
		const checksDir = path.join(gauntletDir, "checks");
		const reviewsDir = path.join(gauntletDir, "reviews");

		await fs.mkdir(tmpDir);
		await fs.mkdir(gauntletDir);
		await fs.writeFile(path.join(gauntletDir, "config.yml"), opts.configYml);

		if (opts.checkFiles) {
			await fs.mkdir(checksDir);
			for (const [name, content] of Object.entries(opts.checkFiles)) {
				await fs.writeFile(path.join(checksDir, name), content);
			}
		}

		if (opts.reviewFiles) {
			await fs.mkdir(reviewsDir);
			for (const [name, content] of Object.entries(opts.reviewFiles)) {
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

	// 6.1: Inline check is loaded and available for entry point reference
	it("should load inline check and make it available for entry point reference", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
checks:
  build:
    command: npm run build
    parallel: true
entry_points:
  - path: "."
    checks:
      - build
`,
		});
		const config = await loadConfig(tmpDir);

		expect(config.checks.build).toBeDefined();
		expect(config.checks.build!.name).toBe("build");
		expect(config.checks.build!.command).toBe("npm run build");
		expect(config.checks.build!.parallel).toBe(true);
	});

	// 6.2: Inline check with only command applies correct defaults
	it("should apply correct defaults for inline check with only command", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
checks:
  minimal:
    command: echo hello
entry_points:
  - path: "."
    checks:
      - minimal
`,
		});
		const config = await loadConfig(tmpDir);

		const check = config.checks.minimal!;
		expect(check.command).toBe("echo hello");
		expect(check.parallel).toBe(false);
		expect(check.run_in_ci).toBe(true);
		expect(check.run_locally).toBe(true);
	});

	// 6.3: Name collision between inline and file-based check produces validation error
	it("should reject name collision between inline and file-based check", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
checks:
  lint:
    command: npx eslint .
entry_points:
  - path: "."
    checks:
      - lint
`,
			checkFiles: {
				"lint.yml": "command: npm run lint\n",
			},
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			/Check "lint" is defined both inline.*and as a file/,
		);
	});

	// 6.4: File-based checks coexist with inline checks
	it("should allow file-based checks to coexist with inline checks", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
checks:
  build:
    command: npm run build
    parallel: true
entry_points:
  - path: "."
    checks:
      - build
      - lint
`,
			checkFiles: {
				"lint.yml": "command: npx eslint .\nparallel: true\n",
			},
		});
		const config = await loadConfig(tmpDir);

		expect(config.checks.build).toBeDefined();
		expect(config.checks.build!.command).toBe("npm run build");
		expect(config.checks.lint).toBeDefined();
		expect(config.checks.lint!.command).toBe("npx eslint .");
	});

	// 6.5: Inline review is loaded and available for entry point reference
	it("should load inline review and make it available for entry point reference", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
reviews:
  code-quality:
    builtin: code-quality
    num_reviews: 1
entry_points:
  - path: "."
    reviews:
      - code-quality
`,
		});
		const config = await loadConfig(tmpDir);

		expect(config.reviews["code-quality"]).toBeDefined();
		expect(config.reviews["code-quality"]!.name).toBe("code-quality");
		expect(config.reviews["code-quality"]!.promptContent).toContain("code-reviewer");
	});

	// 6.6: Inline review with only builtin applies correct defaults
	it("should apply correct defaults for inline review with only builtin", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
reviews:
  minimal:
    builtin: code-quality
entry_points:
  - path: "."
    reviews:
      - minimal
`,
		});
		const config = await loadConfig(tmpDir);

		const review = config.reviews.minimal!;
		expect(review.num_reviews).toBe(1);
		expect(review.parallel).toBe(true);
		expect(review.run_in_ci).toBe(true);
		expect(review.run_locally).toBe(true);
		expect(review.enabled).toBe(true);
	});

	// 6.7: Name collision between inline and file-based review produces validation error
	it("should reject name collision between inline and file-based review", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
reviews:
  code-quality:
    builtin: code-quality
entry_points:
  - path: "."
    reviews:
      - code-quality
`,
			reviewFiles: {
				"code-quality.yml": "builtin: code-quality\n",
			},
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			/Review "code-quality" is defined both inline.*and as a file/,
		);
	});

	// 6.8: Invalid inline check (missing command) produces validation error at config load
	it("should reject invalid inline check missing command", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
checks:
  bad-check:
    parallel: true
entry_points:
  - path: "."
    checks:
      - bad-check
`,
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow();
	});

	// 6.9: Invalid inline review (no prompt source) produces validation error at config load
	it("should reject invalid inline review with no prompt source", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
reviews:
  bad-review:
    num_reviews: 1
entry_points:
  - path: "."
    reviews:
      - bad-review
`,
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow();
	});
});
