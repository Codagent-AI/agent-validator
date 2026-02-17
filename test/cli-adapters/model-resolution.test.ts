import { describe, expect, it } from "bun:test";
import {
	extractVersion,
	isTierVariant,
	matchesBaseName,
	resolveModelFromList,
} from "../../src/cli-adapters/model-resolution.js";

describe("matchesBaseName", () => {
	it("matches exact segment", () => {
		expect(matchesBaseName("gpt-5.3-codex", "codex")).toBe(true);
	});
	it("matches with suffix", () => {
		expect(matchesBaseName("gpt-5.3-codex-low", "codex")).toBe(true);
	});
	it("does not match partial segment", () => {
		expect(matchesBaseName("gpt-5.3-codecx", "codex")).toBe(false);
	});
	it("matches at start", () => {
		expect(matchesBaseName("opus-4.6", "opus")).toBe(true);
	});
});

describe("isTierVariant", () => {
	it("detects -low", () =>
		expect(isTierVariant("gpt-5.3-codex-low")).toBe(true));
	it("detects -high", () =>
		expect(isTierVariant("gpt-5.3-codex-high")).toBe(true));
	it("detects -xhigh", () =>
		expect(isTierVariant("gpt-5.3-codex-xhigh")).toBe(true));
	it("detects -fast", () =>
		expect(isTierVariant("gpt-5.3-codex-fast")).toBe(true));
	it("non-tier is false", () =>
		expect(isTierVariant("gpt-5.3-codex")).toBe(false));
	it("-thinking is not a tier", () =>
		expect(isTierVariant("opus-4.6-thinking")).toBe(false));
});

describe("extractVersion", () => {
	it("extracts major.minor", () =>
		expect(extractVersion("gpt-5.3-codex")).toEqual([5, 3]));
	it("extracts from prefix", () =>
		expect(extractVersion("opus-4.6")).toEqual([4, 6]));
	it("returns null for no version", () =>
		expect(extractVersion("codex")).toBeNull());
});

describe("resolveModelFromList", () => {
	it("selects highest version", () => {
		const models = ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex"];
		expect(
			resolveModelFromList(models, "codex", { preferThinking: false }),
		).toBe("gpt-5.3-codex");
	});

	it("excludes tier variants", () => {
		const models = ["gpt-5.3-codex", "gpt-5.3-codex-low", "gpt-5.3-codex-high"];
		expect(
			resolveModelFromList(models, "codex", { preferThinking: false }),
		).toBe("gpt-5.3-codex");
	});

	it("prefers thinking variant when requested", () => {
		const models = [
			"opus-4.6",
			"opus-4.6-thinking",
			"opus-4.5",
			"opus-4.5-thinking",
		];
		expect(resolveModelFromList(models, "opus", { preferThinking: true })).toBe(
			"opus-4.6-thinking",
		);
	});

	it("falls back to non-thinking when no thinking variant exists", () => {
		const models = ["gpt-5.3-codex"];
		expect(
			resolveModelFromList(models, "codex", { preferThinking: true }),
		).toBe("gpt-5.3-codex");
	});

	it("returns undefined for no matches", () => {
		const models = ["gpt-5.3-codex"];
		expect(
			resolveModelFromList(models, "nonexistent", { preferThinking: false }),
		).toBeUndefined();
	});

	it("excludes thinking variants when not preferred", () => {
		const models = ["opus-4.6", "opus-4.6-thinking"];
		expect(
			resolveModelFromList(models, "opus", { preferThinking: false }),
		).toBe("opus-4.6");
	});
});
