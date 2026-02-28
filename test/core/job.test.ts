import { describe, expect, it } from "bun:test";
import type {
	LoadedCheckGateConfig,
	LoadedConfig,
	LoadedReviewGateConfig,
} from "../../src/config/types.js";
import type { ExpandedEntryPoint } from "../../src/core/entry-point.js";
import { JobGenerator } from "../../src/core/job.js";

function makeCheckConfig(
	overrides: Partial<LoadedCheckGateConfig> = {},
): LoadedCheckGateConfig {
	return {
		name: "test",
		command: "bun test",
		parallel: true,
		run_locally: true,
		run_in_ci: true,
		...overrides,
	};
}

function makeReviewConfig(
	overrides: Partial<LoadedReviewGateConfig> = {},
): LoadedReviewGateConfig {
	return {
		name: "test-review",
		prompt: "review.md",
		num_reviews: 1,
		parallel: true,
		run_in_ci: true,
		run_locally: true,
		enabled: true,
		...overrides,
	};
}

function makeConfig(
	checks: Record<string, LoadedCheckGateConfig> = {},
	reviews: Record<string, any> = {},
): LoadedConfig {
	return {
		project: {
			base_branch: "main",
			log_dir: "gauntlet_logs",
			allow_parallel: true,
			max_retries: 3,
			max_previous_logs: 3,
			rerun_new_issue_threshold: "high",
			cli: { default_preference: ["claude"] },
			entry_points: [],
		},
		checks,
		reviews,
	};
}

describe("JobGenerator", () => {
	describe("deduplication", () => {
		it("should deduplicate checks with same name and working directory from different entry points", () => {
			const config = makeConfig({
				test: makeCheckConfig({
					name: "test",
					command: "bun test",
					working_directory: ".",
				}),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{ path: "src", config: { path: "src", checks: ["test"] } },
				{
					path: "package.json",
					config: { path: "package.json", checks: ["test"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);
			const testJobs = jobs.filter((j) => j.name === "test");

			expect(testJobs).toHaveLength(1);
			expect(testJobs[0].workingDirectory).toBe(".");
		});

		it("should NOT deduplicate checks with same name but different working directories", () => {
			const config = makeConfig({
				test: makeCheckConfig({
					name: "test",
					command: "bun test",
					working_directory: "entrypoint",
				}),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "lib/foo",
					config: { path: "lib/*", checks: ["test"] },
				},
				{
					path: "lib/bar",
					config: { path: "lib/*", checks: ["test"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);
			const testJobs = jobs.filter((j) => j.name === "test");

			expect(testJobs).toHaveLength(2);
			expect(testJobs.map((j) => j.workingDirectory).sort()).toEqual([
				"lib/bar",
				"lib/foo",
			]);
		});

		it("should deduplicate checks with no explicit working_directory from overlapping entry points", () => {
			const config = makeConfig({
				lint: makeCheckConfig({ name: "lint", command: "bun lint" }),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{ path: "src", config: { path: "src", checks: ["lint"] } },
				{ path: "src", config: { path: "src", checks: ["lint"] } },
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs).toHaveLength(1);
			expect(jobs[0].workingDirectory).toBe("src");
		});
	});

	describe("job ID uses working directory", () => {
		it("should use working directory in job ID instead of entry point", () => {
			const config = makeConfig({
				build: makeCheckConfig({
					name: "build",
					command: "bun run build",
					working_directory: ".",
				}),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{ path: "src", config: { path: "src", checks: ["build"] } },
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs[0].id).toBe("check:.:build");
		});

		it("should use entry point path in job ID when no explicit working directory", () => {
			const config = makeConfig({
				lint: makeCheckConfig({ name: "lint", command: "bun lint" }),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{ path: "src", config: { path: "src", checks: ["lint"] } },
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs[0].id).toBe("check:src:lint");
		});
	});

	describe("working_directory: entrypoint", () => {
		it("should resolve 'entrypoint' to the expanded entry point path", () => {
			const config = makeConfig({
				test: makeCheckConfig({
					name: "test",
					command: "bun test",
					working_directory: "entrypoint",
				}),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "lib/foo",
					config: { path: "lib/*", checks: ["test"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs).toHaveLength(1);
			expect(jobs[0].workingDirectory).toBe("lib/foo");
			expect(jobs[0].id).toBe("check:lib/foo:test");
		});

		it("should create separate jobs per expanded wildcard entry point", () => {
			const config = makeConfig({
				test: makeCheckConfig({
					name: "test",
					command: "bun test",
					working_directory: "entrypoint",
				}),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "lib/foo",
					config: { path: "lib/*", checks: ["test"] },
				},
				{
					path: "lib/bar",
					config: { path: "lib/*", checks: ["test"] },
				},
				{
					path: "lib/baz",
					config: { path: "lib/*", checks: ["test"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs).toHaveLength(3);
			expect(jobs.map((j) => j.workingDirectory).sort()).toEqual([
				"lib/bar",
				"lib/baz",
				"lib/foo",
			]);
			expect(jobs.map((j) => j.id).sort()).toEqual([
				"check:lib/bar:test",
				"check:lib/baz:test",
				"check:lib/foo:test",
			]);
		});

		it("should still deduplicate when entrypoint resolves to same path", () => {
			const config = makeConfig({
				test: makeCheckConfig({
					name: "test",
					command: "bun test",
					working_directory: "entrypoint",
				}),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "lib/foo",
					config: { path: "lib/*", checks: ["test"] },
				},
				{
					path: "lib/foo",
					config: { path: "lib/foo", checks: ["test"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs).toHaveLength(1);
			expect(jobs[0].workingDirectory).toBe("lib/foo");
		});
	});

	describe("working directory fallback", () => {
		it("should default working directory to entry point path when not specified", () => {
			const config = makeConfig({
				lint: makeCheckConfig({ name: "lint", command: "bun lint" }),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "apps/api",
					config: { path: "apps/api", checks: ["lint"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs[0].workingDirectory).toBe("apps/api");
		});

		it("should use explicit working_directory when it is a regular path", () => {
			const config = makeConfig({
				build: makeCheckConfig({
					name: "build",
					command: "bun run build",
					working_directory: ".",
				}),
			});

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "apps/api",
					config: { path: "apps/api", checks: ["build"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs[0].workingDirectory).toBe(".");
		});
	});

	describe("reviews are not affected", () => {
		it("should still use entry point path for review working directory", () => {
			const config = makeConfig(
				{},
				{
					"code-quality": makeReviewConfig({
						name: "code-quality",
						prompt: "review.md",
					}),
				},
			);

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "src",
					config: { path: "src", reviews: ["code-quality"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);

			expect(jobs).toHaveLength(1);
			expect(jobs[0].workingDirectory).toBe("src");
			expect(jobs[0].id).toBe("review:src:code-quality");
		});
	});

	describe("enabled filtering", () => {
		it("should skip disabled review when no enable-review override provided", () => {
			const config = makeConfig(
				{},
				{
					"task-compliance": makeReviewConfig({
						name: "task-compliance",
						prompt: "task-compliance.md",
						enabled: false,
					}),
				},
			);

			const generator = new JobGenerator(config);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "src",
					config: { path: "src", reviews: ["task-compliance"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);
			expect(jobs).toHaveLength(0);
		});

		it("should activate disabled review when its name appears in enableReviews", () => {
			const config = makeConfig(
				{},
				{
					"task-compliance": makeReviewConfig({
						name: "task-compliance",
						prompt: "task-compliance.md",
						enabled: false,
					}),
				},
			);

			const generator = new JobGenerator(config, new Set(["task-compliance"]));
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "src",
					config: { path: "src", reviews: ["task-compliance"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].name).toBe("task-compliance");
		});

		it("should not affect enabled reviews when enableReviews is set for another review", () => {
			const config = makeConfig(
				{},
				{
					"code-quality": makeReviewConfig({
						name: "code-quality",
						prompt: "code-quality.md",
						enabled: true,
					}),
				},
			);

			const generator = new JobGenerator(config, new Set(["other-review"]));
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "src",
					config: { path: "src", reviews: ["code-quality"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].name).toBe("code-quality");
		});

		it("should activate multiple disabled reviews via enableReviews set", () => {
			const config = makeConfig(
				{},
				{
					"task-compliance": makeReviewConfig({
						name: "task-compliance",
						prompt: "task-compliance.md",
						enabled: false,
					}),
					security: makeReviewConfig({
						name: "security",
						prompt: "security.md",
						enabled: false,
					}),
				},
			);

			const generator = new JobGenerator(
				config,
				new Set(["task-compliance", "security"]),
			);
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "src",
					config: {
						path: "src",
						reviews: ["task-compliance", "security"],
					},
				},
			];

			const jobs = generator.generateJobs(entryPoints);
			expect(jobs).toHaveLength(2);
			const names = jobs.map((j) => j.name).sort();
			expect(names).toEqual(["security", "task-compliance"]);
		});

		it("should silently ignore enableReviews names that do not match any configured review", () => {
			const config = makeConfig(
				{},
				{
					"code-quality": makeReviewConfig({
						name: "code-quality",
						prompt: "code-quality.md",
						enabled: true,
					}),
				},
			);

			const generator = new JobGenerator(config, new Set(["nonexistent"]));
			const entryPoints: ExpandedEntryPoint[] = [
				{
					path: "src",
					config: { path: "src", reviews: ["code-quality"] },
				},
			];

			const jobs = generator.generateJobs(entryPoints);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].name).toBe("code-quality");
		});
	});
});
