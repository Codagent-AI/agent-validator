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

const SKILL_ACTIONS = [
	"run",
	"check",
	"push-pr",
	"fix-pr",
	"status",
	"help",
	"setup",
] as const;

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

describe("agent-gauntlet init (E2E)", () => {
	it("should exit successfully", () => {
		if (!canRun) return; // skip
		expect(initResult.exitCode).toBe(0);
	});

	it("should install all skill directories with SKILL.md", async () => {
		if (!canRun) return;
		for (const action of SKILL_ACTIONS) {
			const skillMd = path.join(
				tempDir,
				".claude",
				"skills",
				`gauntlet-${action}`,
				"SKILL.md",
			);
			const stat = await fs.stat(skillMd).catch(() => null);
			expect(stat?.isFile()).toBe(true);
		}
	});

	it("should scaffold .gauntlet/ with config and review", async () => {
		if (!canRun) return;
		const configPath = path.join(tempDir, ".gauntlet", "config.yml");
		const reviewPath = path.join(
			tempDir,
			".gauntlet",
			"reviews",
			"code-quality.yml",
		);
		expect((await fs.stat(configPath).catch(() => null))?.isFile()).toBe(true);
		expect((await fs.stat(reviewPath).catch(() => null))?.isFile()).toBe(true);
	});

	it("should install hooks in settings.local.json", async () => {
		if (!canRun) return;
		const settingsPath = path.join(
			tempDir,
			".claude",
			"settings.local.json",
		);
		const content = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
		const hooks = content.hooks ?? {};
		expect(Array.isArray(hooks.Stop)).toBe(true);
		expect(hooks.Stop.length).toBeGreaterThan(0);
		expect(Array.isArray(hooks.SessionStart)).toBe(true);
		expect(hooks.SessionStart.length).toBeGreaterThan(0);
	});

	it("should add gauntlet_logs to .gitignore", async () => {
		if (!canRun) return;
		const gitignore = await fs.readFile(
			path.join(tempDir, ".gitignore"),
			"utf-8",
		);
		expect(gitignore).toContain("gauntlet_logs");
	});
});
