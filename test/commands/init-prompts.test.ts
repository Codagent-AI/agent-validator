import { describe, expect, it, mock } from "bun:test";

// Mock @inquirer/prompts before importing our module
mock.module("@inquirer/prompts", () => ({
	checkbox: async () => ["claude", "codex"],
	number: async () => 2,
	confirm: async () => true,
}));

const {
	promptDevCLIs,
	promptReviewCLIs,
	promptNumReviews,
	promptFileOverwrite,
	promptHookOverwrite,
} = await import("../../src/commands/init-prompts.js");

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
	it("should return true when skipPrompts is true", async () => {
		const result = await promptFileOverwrite("gauntlet-run", true);
		expect(result).toBe(true);
	});

	it("should call confirm when skipPrompts is false", async () => {
		const result = await promptFileOverwrite("gauntlet-run", false);
		expect(result).toBe(true); // mocked to return true
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
