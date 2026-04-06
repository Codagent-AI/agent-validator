import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	createClaudeStub,
	initGitRepo,
	isDistBuilt,
	spawnValidator,
} from "./helpers.js";

let tempDir: string;
let stubBinDir: string;
let initResult: { exitCode: number; stdout: string; stderr: string };
let canRun: boolean;

beforeAll(async () => {
	canRun = isDistBuilt();
	if (!canRun) return;

	const stub = await createClaudeStub();
	stubBinDir = stub.binDir;

	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-init-e2e-"));
	await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
	await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export {};\n");
	await initGitRepo(tempDir);

	initResult = await spawnValidator(["init", "--yes"], {
		cwd: tempDir,
		env: { ...process.env, PATH: `${stubBinDir}:${process.env.PATH}` },
	});
}, 30_000);

afterAll(async () => {
	if (tempDir) {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
	if (stubBinDir) {
		await fs.rm(stubBinDir, { recursive: true, force: true }).catch(() => {});
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

	it("should scaffold .validator/ with config using recommended review config", async () => {
		if (!canRun) return;
		const configPath = path.join(tempDir, ".validator", "config.yml");
		expect((await fs.stat(configPath).catch(() => null))?.isFile()).toBe(true);
		const configContent = await fs.readFile(configPath, "utf-8");
		expect(configContent).toContain("entry_points: []");
		expect(configContent).toContain("reviews:");
		expect(configContent).toContain("builtin:");
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
