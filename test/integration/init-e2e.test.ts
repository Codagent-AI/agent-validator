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
let homeDir: string;
let stubBinDir: string;
let agentPluginLog: string;
let initResult: { exitCode: number; stdout: string; stderr: string };
let canRun: boolean;

beforeAll(async () => {
	canRun = isDistBuilt();
	if (!canRun) return;

	const stub = await createClaudeStub();
	stubBinDir = stub.binDir;

	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-init-e2e-"));
	homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-init-home-"));
	agentPluginLog = path.join(tempDir, "agent-plugin-calls.jsonl");
	const agentPluginPath = path.join(
		homeDir,
		"codagent",
		"agent-plugin",
		"dist",
		"index.js",
	);
	await fs.mkdir(path.dirname(agentPluginPath), { recursive: true });
	await fs.writeFile(
		agentPluginPath,
		[
			"#!/usr/bin/env node",
			'import fs from "node:fs";',
			"const log = process.env.AGENT_PLUGIN_STUB_LOG;",
			"if (log) fs.appendFileSync(log, `${JSON.stringify(process.argv.slice(2))}\\n`);",
			"process.exit(0);",
			"",
		].join("\n"),
	);
	await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
	await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export {};\n");
	await initGitRepo(tempDir);

	initResult = await spawnValidator(["init", "--yes"], {
		cwd: tempDir,
		env: {
			...process.env,
			AGENT_PLUGIN_BIN: agentPluginPath,
			AGENT_PLUGIN_STUB_LOG: agentPluginLog,
			HOME: homeDir,
			PATH: `${stubBinDir}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
		},
	});
}, 30_000);

afterAll(async () => {
	if (tempDir) {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
	if (stubBinDir) {
		await fs.rm(stubBinDir, { recursive: true, force: true }).catch(() => {});
	}
	if (homeDir) {
		await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("agent-validator init (E2E)", () => {
	it("should exit successfully", () => {
		if (!canRun) return; // skip
		expect(initResult.exitCode).toBe(0);
	});

	it("should not write Claude local settings during init", async () => {
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
		// Reviews should be inline under entry_points, not top-level
		expect(configContent).toContain("- path: .");
		expect(configContent).toContain("builtin: all-reviewers");
		expect(configContent).not.toMatch(/^reviews:/m);
	});

	it("should add validator_logs to .gitignore", async () => {
		if (!canRun) return;
		const gitignore = await fs.readFile(
			path.join(tempDir, ".gitignore"),
			"utf-8",
		);
		expect(gitignore).toContain("validator_logs");
	});

	it("should dry-run agent-plugin before installing with --yes", async () => {
		if (!canRun) return;
		const calls = (await fs.readFile(agentPluginLog, "utf-8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(calls).toEqual([
			[
				"add",
				"Codagent-AI/agent-validator",
				"--agent",
				"claude",
				"--dry-run",
			],
			[
				"add",
				"Codagent-AI/agent-validator",
				"--agent",
				"claude",
				"--yes",
			],
		]);
	});
});
