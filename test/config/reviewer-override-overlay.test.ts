import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ADAPTER_CONFIG } from "../../src/config/adapter-defaults.js";
import { loadConfig } from "../../src/config/loader.js";
import {
	REVIEWER_CLI_ENV,
	REVIEWER_EFFORT_ENV,
	REVIEWER_MODEL_ENV,
	ReviewerOverrideError,
} from "../../src/config/reviewer-override.js";
import { JobGenerator } from "../../src/core/job.js";
import { generateReviewAssignments } from "../../src/gates/review-helpers.js";

const OVERRIDE_KEYS = [
	REVIEWER_CLI_ENV,
	REVIEWER_MODEL_ENV,
	REVIEWER_EFFORT_ENV,
] as const;

function clearOverrideEnv(): void {
	for (const key of OVERRIDE_KEYS) {
		delete process.env[key];
	}
}

function setOverrideEnv(env: Record<string, string>): void {
	clearOverrideEnv();
	Object.assign(process.env, env);
}

async function writeProject(
	configYml: string,
): Promise<{ root: string; configPath: string }> {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "validator-reviewer-override-"),
	);
	const configDir = path.join(root, ".validator");
	await fs.mkdir(configDir, { recursive: true });
	const configPath = path.join(configDir, "config.yml");
	await fs.writeFile(configPath, configYml);
	return { root, configPath };
}

const INT001_CONFIG = `
cli:
  default_preference:
    - codex
  adapters:
    codex:
      allow_tool_use: true
      thinking_budget: medium
entry_points:
  - path: "."
    reviews:
      - pinned:
          builtin: code-quality
          cli_preference:
            - codex
      - multi:
          builtin: security
          num_reviews: 2
      - disabled:
          builtin: error-handling
          enabled: false
`;

describe("loadConfig reviewer override overlay", () => {
	afterEach(() => {
		clearOverrideEnv();
	});

	it("INT-001: replaces preferences before merge and keeps num_reviews and enablement", async () => {
		const { root, configPath } = await writeProject(INT001_CONFIG);
		const originalBytes = await fs.readFile(configPath, "utf-8");
		setOverrideEnv({ [REVIEWER_CLI_ENV]: "claude" });

		const config = await loadConfig(root, { applyReviewerOverride: true });

		expect(config.project.cli.default_preference).toEqual(["claude"]);
		expect(config.reviews.pinned?.cli_preference).toEqual(["claude"]);
		expect(config.reviews.multi?.cli_preference).toEqual(["claude"]);
		expect(config.reviews.disabled?.cli_preference).toEqual(["claude"]);
		expect(config.reviews.multi?.num_reviews).toBe(2);
		expect(config.reviews.disabled?.enabled).toBe(false);
		expect(config.reviewerOverride).toEqual({
			source: "runner-reviewer-role",
			adapter: "claude",
		});

		const slots = generateReviewAssignments(config.reviews.multi!.num_reviews, [
			"claude",
		]);
		expect(slots).toEqual([
			{ adapter: "claude", reviewIndex: 1 },
			{ adapter: "claude", reviewIndex: 2 },
		]);

		const jobs = new JobGenerator(config).generateJobs([
			{
				path: ".",
				config: {
					path: ".",
					reviews: ["pinned", "multi", "disabled"],
				},
			},
		]);
		expect(jobs.map((job) => job.name).sort()).toEqual(["multi", "pinned"]);
		expect(jobs.some((job) => job.name === "disabled")).toBe(false);

		expect(await fs.readFile(configPath, "utf-8")).toBe(originalBytes);
		await fs.rm(root, { recursive: true, force: true });
	});

	it("does not overlay when applyReviewerOverride is omitted, even if env is set", async () => {
		const { root } = await writeProject(INT001_CONFIG);
		setOverrideEnv({ [REVIEWER_CLI_ENV]: "claude" });

		const config = await loadConfig(root);

		expect(config.project.cli.default_preference).toEqual(["codex"]);
		expect(config.reviews.pinned?.cli_preference).toEqual(["codex"]);
		expect(config.reviewerOverride).toBeUndefined();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("loads the tracked file unchanged when overlay is requested but env is inactive", async () => {
		const { root } = await writeProject(INT001_CONFIG);

		const config = await loadConfig(root, { applyReviewerOverride: true });

		expect(config.project.cli.default_preference).toEqual(["codex"]);
		expect(config.reviewerOverride).toBeUndefined();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("fails closed on a malformed overlay environment before merge", async () => {
		const { root } = await writeProject(INT001_CONFIG);
		setOverrideEnv({ [REVIEWER_MODEL_ENV]: "opus" });

		await expect(
			loadConfig(root, { applyReviewerOverride: true }),
		).rejects.toBeInstanceOf(ReviewerOverrideError);
		await fs.rm(root, { recursive: true, force: true });
	});

	it("CLI-only overlay does not apply role model or thinking budget to an existing adapter", async () => {
		const { root } = await writeProject(`
cli:
  default_preference:
    - claude
  adapters:
    claude:
      allow_tool_use: false
      thinking_budget: low
      model: keep-me
entry_points:
  - path: "."
    reviews:
      - quality:
          builtin: code-quality
`);
		setOverrideEnv({ [REVIEWER_CLI_ENV]: "claude" });

		const config = await loadConfig(root, { applyReviewerOverride: true });

		expect(config.project.cli.adapters?.claude).toEqual({
			allow_tool_use: false,
			thinking_budget: "low",
			model: "keep-me",
		});
		expect(config.reviewerOverride).toEqual({
			source: "runner-reviewer-role",
			adapter: "claude",
		});
		await fs.rm(root, { recursive: true, force: true });
	});

	it("INT-002: keeps existing allow_tool_use and overlays role model and effort", async () => {
		const { root } = await writeProject(`
cli:
  default_preference:
    - claude
  adapters:
    claude:
      allow_tool_use: false
      thinking_budget: low
      model: yaml-adapter-model
entry_points:
  - path: "."
    reviews:
      - quality:
          builtin: code-quality
          model: yaml-review-model
`);
		setOverrideEnv({
			[REVIEWER_CLI_ENV]: "claude",
			[REVIEWER_MODEL_ENV]: "role-model",
			[REVIEWER_EFFORT_ENV]: "high",
		});

		const config = await loadConfig(root, { applyReviewerOverride: true });
		const adapter = config.project.cli.adapters?.claude;

		expect(adapter?.allow_tool_use).toBe(false);
		expect(adapter?.model).toBe("role-model");
		expect(adapter?.thinking_budget).toBe("high");
		expect(config.reviews.quality?.model).toBe("yaml-review-model");
		expect(adapter?.model ?? config.reviews.quality?.model).toBe("role-model");
		await fs.rm(root, { recursive: true, force: true });
	});

	it("INT-002: missing mapped adapter uses init defaults instead of schema or displaced policy", async () => {
		const { root } = await writeProject(`
cli:
  default_preference:
    - gemini
  adapters:
    gemini:
      allow_tool_use: true
      thinking_budget: low
entry_points:
  - path: "."
    reviews:
      - quality:
          builtin: code-quality
`);
		setOverrideEnv({
			[REVIEWER_CLI_ENV]: "claude",
			[REVIEWER_MODEL_ENV]: "role-model",
			[REVIEWER_EFFORT_ENV]: "medium",
		});

		const config = await loadConfig(root, { applyReviewerOverride: true });
		const adapter = config.project.cli.adapters?.claude;

		expect(adapter?.allow_tool_use).toBe(ADAPTER_CONFIG.claude.allow_tool_use);
		expect(adapter?.allow_tool_use).toBe(false);
		expect(adapter?.allow_tool_use).not.toBe(true);
		expect(adapter?.thinking_budget).toBe("medium");
		expect(adapter?.model).toBe("role-model");
		expect(config.project.cli.adapters?.gemini?.allow_tool_use).toBe(true);
		await fs.rm(root, { recursive: true, force: true });
	});

	it("records xhigh collapse on the loaded override identity", async () => {
		const { root } = await writeProject(INT001_CONFIG);
		setOverrideEnv({
			[REVIEWER_CLI_ENV]: "copilot",
			[REVIEWER_EFFORT_ENV]: "xhigh",
		});

		const config = await loadConfig(root, { applyReviewerOverride: true });

		expect(config.project.cli.default_preference).toEqual(["github-copilot"]);
		expect(config.project.cli.adapters?.["github-copilot"]?.thinking_budget).toBe(
			"high",
		);
		expect(config.reviewerOverride).toEqual({
			source: "runner-reviewer-role",
			adapter: "github-copilot",
			effortCollapsed: "xhigh",
		});
		await fs.rm(root, { recursive: true, force: true });
	});
});
