import { readFileSync } from "node:fs";
import YAML from "yaml";
import { loadBuiltInReview } from "../../src/built-in-reviews/index.js";
import type { E2EConfig, E2EReviewerConfig } from "./types.js";

/** Loads and validates an end-to-end eval config file. */
export function loadE2EConfig(path: string): E2EConfig {
	return validateE2EConfig(YAML.parse(readFileSync(path, "utf-8")));
}

export function validateE2EConfig(raw: unknown): E2EConfig {
	const config = raw as Partial<E2EConfig>;
	if (!config.fixture) throw new Error('E2E config needs "fixture"');
	if (!config.lead?.model) throw new Error('E2E config needs "lead.model"');
	if (!config.judge?.adapter) throw new Error('E2E config needs "judge.adapter"');
	if (!config.configs || config.configs.length === 0) {
		throw new Error('E2E config needs at least one entry in "configs"');
	}
	const labels = new Set<string>();
	for (const reviewer of config.configs) {
		validateReviewer(reviewer);
		if (labels.has(reviewer.label)) {
			throw new Error(`Duplicate config label "${reviewer.label}"`);
		}
		labels.add(reviewer.label);
	}
	return {
		fixture: config.fixture,
		runs_per_config: config.runs_per_config ?? 1,
		lead: { ...config.lead, timeout_ms: config.lead.timeout_ms ?? 3_600_000 },
		judge: config.judge,
		configs: config.configs,
	};
}

function validateReviewer(reviewer: E2EReviewerConfig): void {
	if (!reviewer.label) throw new Error("Every config needs a label");
	if (!reviewer.adapter) throw new Error(`Config "${reviewer.label}" needs an adapter`);
	if (!reviewer.reviews || reviewer.reviews.length === 0) {
		throw new Error(`Config "${reviewer.label}" needs at least one review`);
	}
	for (const name of reviewer.reviews) {
		// Throws for unknown built-in names, before any money is spent.
		loadBuiltInReview(name);
	}
}

/** The `.validator/config.yml` the lead agent's validator runs with. */
export function buildValidatorConfig(reviewer: E2EReviewerConfig): string {
	const adapter: Record<string, unknown> = { allow_tool_use: false };
	if (reviewer.thinking_budget) adapter.thinking_budget = reviewer.thinking_budget;
	if (reviewer.model) adapter.model = reviewer.model;

	return YAML.stringify({
		base_branch: "main",
		log_dir: "validator_logs",
		// Keep every archived session so reviewer cost and findings can be collected.
		max_previous_logs: 50,
		cli: {
			default_preference: [reviewer.adapter],
			adapters: { [reviewer.adapter]: adapter },
		},
		entry_points: [
			{
				path: ".",
				exclude: ["validator_logs", ".validator", ".claude"],
				reviews: reviewer.reviews.map((name) => ({ [name]: { builtin: name } })),
			},
		],
	});
}
