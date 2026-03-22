import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	initGitRepo,
	isClaudeAvailable,
	isDistBuilt,
	spawnGauntlet,
} from "./helpers.js";

let tempDir: string;
let initResult: { exitCode: number; stdout: string; stderr: string };
let canRun: boolean;

beforeAll(async () => {
	canRun = isDistBuilt() && (await isClaudeAvailable());
	if (!canRun) return;

	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gauntlet-init-e2e-"));
	await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
	await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export {};\n");
	await initGitRepo(tempDir);

	initResult = await spawnGauntlet(["init", "--yes"], { cwd: tempDir });
});

afterAll(async () => {
	if (tempDir) {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("agent-validator init (E2E)", () => {
	it("should exit successfully", () => {
		if (!canRun) return; // skip
		expect(initResult.exitCode).toBe(0);
	});

	it("should not write Claude hooks to settings.local.json during init", async () => {
		if (!canRun) return;
		const settingsPath = path.join(tempDir, ".claude", "settings.local.json");
		const stat = await fs.stat(settingsPath).catch(() => null);
		expect(stat).toBeNull();
	});

	it("should scaffold .validator/ with config and review", async () => {
		if (!canRun) return;
		const configPath = path.join(tempDir, ".validator", "config.yml");
		const reviewPath = path.join(
			tempDir,
			".validator",
			"reviews",
			"code-quality.yml",
		);
		expect((await fs.stat(configPath).catch(() => null))?.isFile()).toBe(true);
		expect((await fs.stat(reviewPath).catch(() => null))?.isFile()).toBe(true);
	});

	it("should add validator_logs to .gitignore", async () => {
		if (!canRun) return;
		const gitignore = await fs.readFile(
			path.join(tempDir, ".gitignore"),
			"utf-8",
		);
		expect(gitignore).toContain("validator_logs");
	});
});
