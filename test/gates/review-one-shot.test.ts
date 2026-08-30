import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistOneShotReviewScope } from "../../src/gates/review-one-shot.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe("persistOneShotReviewScope", () => {
	it("does not replace an existing malformed review result", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "one-shot-scope-"));
		tempDirs.push(dir);
		const logPath = path.join(dir, "review.log");
		const jsonPath = path.join(dir, "review.json");
		await fs.writeFile(jsonPath, "{malformed");

		await persistOneShotReviewScope(logPath, "codex", {
			fixBase: "abc123",
		});

		expect(await fs.readFile(jsonPath, "utf8")).toBe("{malformed");
	});
});
