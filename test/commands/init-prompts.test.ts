import { beforeEach, describe, expect, it, mock } from "bun:test";

let selectValue = "yes";

// Mock @inquirer/prompts before importing our module
mock.module("@inquirer/prompts", () => ({
	checkbox: async () => ["claude", "codex"],
	number: async () => 2,
	confirm: async () => true,
	select: async () => selectValue,
}));

const {
	promptDevCLIs,
	promptInstallScope,
	promptReviewCLIs,
	promptNumReviews,
	promptFileOverwrite,
	promptHookOverwrite,
} = await import("../../src/commands/init-prompts.js");

const { selectReviewConfig } = await import("../../src/commands/init-reviews.js");

describe("promptDevCLIs", () => {
	it("should return all CLI names when skipPrompts is true", async () => {
		const result = await promptDevCLIs(["claude", "codex", "gemini"], true);
		expect(result).toEqual(["claude", "codex", "gemini"]);
	});

	it("should call checkbox when skipPrompts is false", async () => {
		const result = await promptDevCLIs(["claude", "codex", "gemini"], false);
		expect(result).toEqual(["claude", "codex"]); // mocked return
	});
});

describe("promptInstallScope", () => {
	beforeEach(() => {
		selectValue = "project";
	});

	it("returns project scope when skipPrompts is true", async () => {
		const result = await promptInstallScope(true);
		expect(result).toBe("project");
	});

	it("returns selected scope when prompting", async () => {
		selectValue = "user";
		const result = await promptInstallScope(false);
		expect(result).toBe("user");
	});
});

describe("promptReviewCLIs", () => {
	it("should return all CLI names when skipPrompts is true", async () => {
		const result = await promptReviewCLIs(["claude", "codex"], true);
		expect(result).toEqual(["claude", "codex"]);
	});

	it("should call checkbox when skipPrompts is false", async () => {
		const result = await promptReviewCLIs(["claude", "codex", "gemini"], false);
		expect(result).toEqual(["claude", "codex"]); // mocked return
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

describe("promptHookOverwrite", () => {
	it("should return true when skipPrompts is true", async () => {
		const result = await promptHookOverwrite("settings.local.json", true);
		expect(result).toBe(true);
	});

	it("should call confirm when skipPrompts is false", async () => {
		const result = await promptHookOverwrite("settings.local.json", false);
		expect(result).toBe(true); // mocked to return true
	});
});
