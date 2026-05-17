import { beforeEach, describe, expect, it, mock } from "bun:test";

let selectValue = "yes";
let confirmResponses: boolean[] = [];
let checkboxCalls: { choices?: { name: string; value: string }[] }[] = [];
let selectCalls: { message?: string }[] = [];
let confirmCalls: { message?: string; default?: boolean }[] = [];

// Mock @inquirer/prompts before importing our module
mock.module("@inquirer/prompts", () => ({
	checkbox: async (opts: { choices?: { name: string; value: string }[] }) => {
		checkboxCalls.push(opts);
		return ["claude", "codex"];
	},
	number: async () => 2,
	confirm: async (opts: { message?: string; default?: boolean }) => {
		confirmCalls.push(opts);
		return confirmResponses.length > 0 ? (confirmResponses.shift() ?? true) : true;
	},
	select: async (opts: { message?: string }) => {
		selectCalls.push(opts);
		return selectValue;
	},
}));

const {
	promptDevCLIs,
	promptInstallScope,
	promptLocalAIReviews,
	promptReviewCLIs,
	promptNumReviews,
	promptFileOverwrite,
} = await import("../../src/commands/init-prompts.js");

const { selectReviewConfig } = await import("../../src/commands/init-reviews.js");

describe("promptDevCLIs", () => {
	beforeEach(() => {
		checkboxCalls = [];
	});

	it("should return all CLI names when skipPrompts is true", async () => {
		const result = await promptDevCLIs(["claude", "codex", "gemini"], true);
		expect(result).toEqual(["claude", "codex", "gemini"]);
	});

	it("should call checkbox when skipPrompts is false", async () => {
		const result = await promptDevCLIs(["claude", "codex", "gemini"], false);
		expect(result).toEqual(["claude", "codex"]); // mocked return
	});

	it("should show CLI choices alphabetically", async () => {
		await promptDevCLIs(["opencode", "github-copilot", "codex", "claude"], false);

		expect(checkboxCalls[0]?.choices?.map((choice) => choice.name)).toEqual([
			"claude",
			"codex",
			"github-copilot",
			"opencode",
		]);
	});
});

describe("promptLocalAIReviews", () => {
	beforeEach(() => {
		confirmCalls = [];
		confirmResponses = [];
	});

	it("returns true when skipPrompts is true", async () => {
		const result = await promptLocalAIReviews(true);

		expect(result).toBe(true);
		expect(confirmCalls).toHaveLength(0);
	});

	it("returns true when the user enables local AI reviews", async () => {
		confirmResponses = [true];

		const result = await promptLocalAIReviews(false);

		expect(result).toBe(true);
		expect(confirmCalls).toHaveLength(1);
		expect(confirmCalls[0]?.message).toBe(
			"Enable local AI reviews? (strongly recommended)",
		);
		expect(confirmCalls[0]?.default).toBe(true);
	});

	it("asks for confirmation before disabling local AI reviews", async () => {
		confirmResponses = [false, true];

		const result = await promptLocalAIReviews(false);

		expect(result).toBe(false);
		expect(confirmCalls).toHaveLength(2);
		expect(confirmCalls[1]?.message).toContain(
			"Are you sure you want to skip local AI reviews?",
		);
		expect(confirmCalls[1]?.message).toContain(
			"catch bugs, security issues, and error-handling gaps",
		);
		expect(confirmCalls[1]?.default).toBe(false);
	});

	it("keeps local AI reviews enabled when the user declines the opt-out confirmation", async () => {
		confirmResponses = [false, false];

		const result = await promptLocalAIReviews(false);

		expect(result).toBe(true);
		expect(confirmCalls).toHaveLength(2);
	});
});

describe("promptInstallScope", () => {
	beforeEach(() => {
		selectValue = "project";
		selectCalls = [];
	});

	it("returns user scope when skipPrompts is true", async () => {
		const result = await promptInstallScope(true);
		expect(result).toBe("user");
	});

	it("returns selected scope when prompting", async () => {
		selectValue = "user";
		const result = await promptInstallScope(false);
		expect(result).toBe("user");
	});

	it("explains that it will install Agent Validator assets from the repository", async () => {
		await promptInstallScope(false);

		expect(selectCalls[0]?.message).toBe(
			"Where should Agent Validator install skills and agent plugins from https://github.com/Codagent-AI/agent-validator?\n",
		);
	});
});

describe("promptReviewCLIs", () => {
	beforeEach(() => {
		checkboxCalls = [];
	});

	it("should return all CLI names when skipPrompts is true", async () => {
		const result = await promptReviewCLIs(["claude", "codex"], true);
		expect(result).toEqual(["claude", "codex"]);
	});

	it("should call checkbox when skipPrompts is false", async () => {
		const result = await promptReviewCLIs(["claude", "codex", "gemini"], false);
		expect(result).toEqual(["claude", "codex"]); // mocked return
	});

	it("should show recommended CLI choices first", async () => {
		await promptReviewCLIs(["opencode", "github-copilot", "codex", "claude"], false);

		expect(checkboxCalls[0]?.choices?.map((choice) => choice.name)).toEqual([
			"codex (recommended)",
			"github-copilot (recommended)",
			"claude (programmatic use may be billed at API rates)",
			"opencode",
		]);
		expect(checkboxCalls[0]?.choices?.map((choice) => choice.value)).toEqual([
			"codex",
			"github-copilot",
			"claude",
			"opencode",
		]);
	});
});

describe("promptNumReviews", () => {
	it("should return 1 when only 1 review CLI selected", async () => {
		const result = await promptNumReviews(1, false);
		expect(result).toBe(1);
	});

	it("should return count when skipPrompts is true", async () => {
		const result = await promptNumReviews(3, true);
		expect(result).toBe(3);
	});

	it("should prompt when multiple CLIs and not skipping", async () => {
		const result = await promptNumReviews(3, false);
		expect(result).toBe(2); // mocked to return 2
	});
});

describe("promptFileOverwrite", () => {
	beforeEach(() => {
		selectValue = "yes";
	});

	it("should return 'yes' when skipPrompts is true", async () => {
		const result = await promptFileOverwrite("validator-run", true);
		expect(result).toBe("yes");
	});

	it("should call select when skipPrompts is false", async () => {
		const result = await promptFileOverwrite("validator-run", false);
		expect(result).toBe("yes"); // mocked select returns "yes"
	});
});

describe("selectReviewConfig", () => {
	it("returns primary config when github-copilot is selected", () => {
		const config = selectReviewConfig(["github-copilot", "gemini"]);
		expect(config.type).toBe("primary");
		expect(config.reviews).toHaveLength(2);
		expect(config.reviews[0].name).toBe("code-quality");
		expect(config.reviews[0].builtin).toBe("code-quality");
		expect(config.reviews[0].cli_preference).toEqual(["github-copilot"]);
		expect(config.reviews[0].model).toBe("claude-sonnet-4.6");
		expect(config.reviews[1].name).toBe("security-and-errors");
		expect(config.reviews[1].builtin).toBe("security-and-errors");
		expect(config.reviews[1].cli_preference).toEqual(["github-copilot"]);
		expect(config.reviews[1].model).toBe("gpt-5.3-codex");
	});

	it("returns primary config when both copilot and codex are selected", () => {
		const config = selectReviewConfig(["github-copilot", "codex"]);
		expect(config.type).toBe("primary");
		expect(config.reviews).toHaveLength(2);
	});

	it("returns secondary config when codex is selected without copilot", () => {
		const config = selectReviewConfig(["codex", "gemini"]);
		expect(config.type).toBe("secondary");
		expect(config.reviews).toHaveLength(1);
		expect(config.reviews[0].name).toBe("all-reviewers");
		expect(config.reviews[0].builtin).toBe("all-reviewers");
		expect(config.reviews[0].model).toBe("gpt-5.3-codex");
		expect(config.reviews[0].cli_preference).toBeUndefined();
	});

	it("returns fallback config when neither copilot nor codex is selected", () => {
		const config = selectReviewConfig(["gemini"]);
		expect(config.type).toBe("fallback");
		expect(config.reviews).toHaveLength(1);
		expect(config.reviews[0].name).toBe("all-reviewers");
		expect(config.reviews[0].builtin).toBe("all-reviewers");
		expect(config.reviews[0].model).toBeUndefined();
		expect(config.reviews[0].cli_preference).toBeUndefined();
	});
});
