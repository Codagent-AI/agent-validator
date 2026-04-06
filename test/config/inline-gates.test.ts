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
		const configDir = path.join(tmpDir, ".validator");
		const checksDir = path.join(configDir, "checks");
		const reviewsDir = path.join(configDir, "reviews");

		await fs.mkdir(tmpDir);
		await fs.mkdir(configDir);
		await fs.writeFile(path.join(configDir, "config.yml"), opts.configYml);

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

	// Inline check defined inside entry_point is loaded
	it("should load inline check from entry_point", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - build:
          command: npm run build
          parallel: true
`,
		});
		const config = await loadConfig(tmpDir);

		expect(config.checks.build).toBeDefined();
		expect(config.checks.build!.name).toBe("build");
		expect(config.checks.build!.command).toBe("npm run build");
		expect(config.checks.build!.parallel).toBe(true);
	});

	// Inline check with only command applies correct defaults
	it("should apply correct defaults for inline check with only command", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - minimal:
          command: echo hello
`,
		});
		const config = await loadConfig(tmpDir);

		const check = config.checks.minimal!;
		expect(check.command).toBe("echo hello");
		expect(check.parallel).toBe(true);
		expect(check.run_in_ci).toBe(true);
		expect(check.run_locally).toBe(true);
	});

	// Name collision between inline and file-based check produces validation error
	it("should reject name collision between inline and file-based check", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - lint:
          command: npx eslint .
`,
			checkFiles: {
				"lint.yml": "command: npm run lint\n",
			},
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			/Check "lint" is defined both inline.*and as a file/,
		);
	});

	// File-based checks coexist with inline checks
	it("should allow file-based checks to coexist with inline checks", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - build:
          command: npm run build
          parallel: true
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

	// Inline review defined inside entry_point is loaded
	it("should load inline review from entry_point", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - code-quality:
          builtin: code-quality
          num_reviews: 1
`,
		});
		const config = await loadConfig(tmpDir);

		expect(config.reviews["code-quality"]).toBeDefined();
		expect(config.reviews["code-quality"]!.name).toBe("code-quality");
		expect(config.reviews["code-quality"]!.promptContent).toContain("Code Quality Review");
	});

	// Inline review with only builtin applies correct defaults
	it("should apply correct defaults for inline review with only builtin", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - minimal:
          builtin: code-quality
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

	// Name collision between inline and file-based review produces validation error
	it("should reject name collision between inline and file-based review", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - code-quality:
          builtin: code-quality
`,
			reviewFiles: {
				"code-quality.yml": "builtin: code-quality\n",
			},
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			/Review "code-quality" is defined both inline.*and as a file/,
		);
	});

	// Invalid inline check (missing command) produces validation error at config load
	it("should reject invalid inline check missing command", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - bad-check:
          parallel: true
`,
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow();
	});

	// Invalid inline review (no prompt source) produces validation error at config load
	it("should reject invalid inline review with no prompt source", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    reviews:
      - bad-review:
          num_reviews: 1
`,
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow();
	});

	// Duplicate inline check across entry_points is rejected
	it("should reject same inline check defined in multiple entry_points", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - build:
          command: npm run build
  - path: "apps/api"
    checks:
      - build:
          command: npm run build
`,
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow(
			/Check "build" is defined inline in more than one entry point/,
		);
	});

	// Entry point can reference an inline check defined in another entry_point by name
	it("should allow referencing an inline check by name from another entry_point", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - build:
          command: npm run build
  - path: "apps/api"
    checks:
      - build
`,
		});
		const config = await loadConfig(tmpDir);

		expect(config.checks.build).toBeDefined();
		// Both entry points reference the same check name
		expect(config.project.entry_points[0]!.checks).toEqual(["build"]);
		expect(config.project.entry_points[1]!.checks).toEqual(["build"]);
	});

	// Top-level checks/reviews are NOT allowed
	it("should reject top-level checks map", async () => {
		await setupTestEnv({
			configYml: `
cli:
  default_preference:
    - claude
checks:
  build:
    command: npm run build
entry_points:
  - path: "."
    checks:
      - build
`,
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow();
	});

	it("should reject top-level reviews map", async () => {
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
		});
		await expect(loadConfig(tmpDir)).rejects.toThrow();
	});
});
