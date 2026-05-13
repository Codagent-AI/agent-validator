import { describe, expect, it } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	loadReviewPrompt,
	resolveEvalConfigPath,
	type EvalConfig,
} from "../../evals/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evalsDir = resolve(repoRoot, "evals");

describe("eval runner helpers", () => {
	it("resolves an explicit eval config path relative to evals/", () => {
		expect(resolveEvalConfigPath(evalsDir, "eval-config-all-reviewers-new.yml")).toBe(
			resolve(evalsDir, "eval-config-all-reviewers-new.yml"),
		);
	});

	it("loads combined built-in review prompts without a markdown file", () => {
		const config: EvalConfig = {
			fixture: "fixtures/all-reviewers",
			adapters: [],
			runs_per_config: 1,
			timeout_ms: 600_000,
			judge: { adapter: "claude", thinking_budget: "high" },
		};

		const prompt = loadReviewPrompt(evalsDir, config);

		expect(prompt).toContain("# Code Quality Review");
		expect(prompt).toContain("# Security Review");
		expect(prompt).toContain("# Error Handling Review");
	});
});
