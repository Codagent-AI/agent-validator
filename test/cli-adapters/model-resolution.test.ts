import { describe, expect, it } from "bun:test";
import {
	resolveModelFromList,
	SAFE_MODEL_ID_PATTERN,
} from "../../src/cli-adapters/model-resolution.js";

describe("SAFE_MODEL_ID_PATTERN", () => {
	it("accepts alphanumeric with hyphens and dots", () => {
		expect(SAFE_MODEL_ID_PATTERN.test("gpt-5.3-codex")).toBe(true);
	});
	it("rejects shell metacharacters", () => {
		expect(SAFE_MODEL_ID_PATTERN.test("model; rm -rf /")).toBe(false);
	});
	it("rejects backticks", () => {
		expect(SAFE_MODEL_ID_PATTERN.test("model`whoami`")).toBe(false);
	});
});

describe("resolveModelFromList", () => {
	it("selects highest version", () => {
		const models = ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex"];
		expect(
			resolveModelFromList(models, {
				baseName: "codex",
				preferThinking: false,
			}),
		).toBe("gpt-5.3-codex");
	});

	it("uses exact model id when listed", () => {
		const models = ["composer-1.5", "composer-2", "composer-2-fast"];
		expect(
			resolveModelFromList(models, {
				baseName: "composer-2",
				preferThinking: false,
			}),
		).toBe("composer-2");
	});

	it("excludes tier variants", () => {
		const models = ["gpt-5.3-codex", "gpt-5.3-codex-low", "gpt-5.3-codex-high"];
		expect(
			resolveModelFromList(models, {
				baseName: "codex",
				preferThinking: false,
			}),
		).toBe("gpt-5.3-codex");
	});

	it("prefers thinking variant when requested", () => {
		const models = [
			"opus-4.6",
			"opus-4.6-thinking",
			"opus-4.5",
			"opus-4.5-thinking",
		];
		expect(
			resolveModelFromList(models, { baseName: "opus", preferThinking: true }),
		).toBe("opus-4.6-thinking");
	});

	it("falls back to non-thinking when no thinking variant exists", () => {
		const models = ["gpt-5.3-codex"];
		expect(
			resolveModelFromList(models, { baseName: "codex", preferThinking: true }),
		).toBe("gpt-5.3-codex");
	});

	it("returns undefined for no matches", () => {
		const models = ["gpt-5.3-codex"];
		expect(
			resolveModelFromList(models, {
				baseName: "nonexistent",
				preferThinking: false,
			}),
		).toBeUndefined();
	});

	it("excludes thinking variants when not preferred", () => {
		const models = ["opus-4.6", "opus-4.6-thinking"];
		expect(
			resolveModelFromList(models, { baseName: "opus", preferThinking: false }),
		).toBe("opus-4.6");
	});

	it("uses segment matching (codex does not match codecx)", () => {
		const models = ["gpt-5.3-codex", "gpt-5.3-codecx"];
		expect(
			resolveModelFromList(models, {
				baseName: "codex",
				preferThinking: false,
			}),
		).toBe("gpt-5.3-codex");
	});

	it("matches segment at start of id", () => {
		const models = ["opus-4.6"];
		expect(
			resolveModelFromList(models, { baseName: "opus", preferThinking: false }),
		).toBe("opus-4.6");
	});

	it("excludes -fast tier variant", () => {
		const models = ["gpt-5.3-codex", "gpt-5.3-codex-fast"];
		expect(
			resolveModelFromList(models, {
				baseName: "codex",
				preferThinking: false,
			}),
		).toBe("gpt-5.3-codex");
	});

	it("excludes -xhigh tier variant", () => {
		const models = ["gpt-5.3-codex", "gpt-5.3-codex-xhigh"];
		expect(
			resolveModelFromList(models, {
				baseName: "codex",
				preferThinking: false,
			}),
		).toBe("gpt-5.3-codex");
	});
});
