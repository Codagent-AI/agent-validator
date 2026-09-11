import { describe, expect, it } from "bun:test";
import {
	REVIEWER_CLI_ENV,
	REVIEWER_EFFORT_ENV,
	REVIEWER_MODEL_ENV,
	ReviewerOverrideError,
	parseReviewerOverrideEnv,
} from "../../src/config/reviewer-override.js";

describe("parseReviewerOverrideEnv", () => {
	it("is inactive when none of the three variables is set", () => {
		expect(parseReviewerOverrideEnv({})).toEqual({ active: false });
	});

	it("fails closed when an override variable is present but empty after trim", () => {
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "  ",
				[REVIEWER_MODEL_ENV]: "\t",
				[REVIEWER_EFFORT_ENV]: "\n",
			}),
		).toThrow(/AGENT_VALIDATOR_REVIEWER_CLI/);
	});

	it("trims surrounding whitespace on CLI, model, and effort", () => {
		const result = parseReviewerOverrideEnv({
			[REVIEWER_CLI_ENV]: "  claude  ",
			[REVIEWER_MODEL_ENV]: "  opus-4  ",
			[REVIEWER_EFFORT_ENV]: "  high  ",
		});
		expect(result).toEqual({
			active: true,
			adapter: "claude",
			model: "opus-4",
			thinkingBudget: "high",
		});
	});

	it("activates from CLI alone and does not overlay model or effort", () => {
		expect(
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "codex",
			}),
		).toEqual({
			active: true,
			adapter: "codex",
		});
	});

	it("activates from model alone and fails because CLI is missing", () => {
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_MODEL_ENV]: "opus",
			}),
		).toThrow(ReviewerOverrideError);
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_MODEL_ENV]: "opus",
			}),
		).toThrow(/AGENT_VALIDATOR_REVIEWER_CLI/);
	});

	it("activates from effort alone and fails because CLI is missing", () => {
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_EFFORT_ENV]: "high",
			}),
		).toThrow(/AGENT_VALIDATOR_REVIEWER_CLI/);
	});

	it("rejects an unknown CLI including gemini", () => {
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "gemini",
			}),
		).toThrow(ReviewerOverrideError);
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "gemini",
			}),
		).toThrow(/AGENT_VALIDATOR_REVIEWER_CLI/);
	});

	it("rejects Copilot with the wrong case", () => {
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "Copilot",
			}),
		).toThrow(/AGENT_VALIDATOR_REVIEWER_CLI/);
	});

	it("maps copilot to github-copilot", () => {
		expect(
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "copilot",
			}),
		).toEqual({
			active: true,
			adapter: "github-copilot",
		});
	});

	it("maps cursor and opencode to the same adapter key", () => {
		expect(
			parseReviewerOverrideEnv({ [REVIEWER_CLI_ENV]: "cursor" }),
		).toEqual({ active: true, adapter: "cursor" });
		expect(
			parseReviewerOverrideEnv({ [REVIEWER_CLI_ENV]: "opencode" }),
		).toEqual({ active: true, adapter: "opencode" });
	});

	it("rejects an unknown effort value", () => {
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "claude",
				[REVIEWER_EFFORT_ENV]: "off",
			}),
		).toThrow(ReviewerOverrideError);
		expect(() =>
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "claude",
				[REVIEWER_EFFORT_ENV]: "off",
			}),
		).toThrow(/AGENT_VALIDATOR_REVIEWER_EFFORT/);
	});

	it("maps medium effort through unchanged", () => {
		expect(
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "claude",
				[REVIEWER_EFFORT_ENV]: "medium",
			}),
		).toEqual({
			active: true,
			adapter: "claude",
			thinkingBudget: "medium",
		});
	});

	it("collapses xhigh to high and records the mapping", () => {
		expect(
			parseReviewerOverrideEnv({
				[REVIEWER_CLI_ENV]: "claude",
				[REVIEWER_EFFORT_ENV]: "xhigh",
			}),
		).toEqual({
			active: true,
			adapter: "claude",
			thinkingBudget: "high",
			effortCollapsed: "xhigh",
		});
	});
});
