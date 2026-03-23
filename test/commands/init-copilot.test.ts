import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

let selectedDevCliNames: string[] = ["github-copilot"];
let selectedReviewCliNames: string[] = ["github-copilot"];
let selectedInstallScope: "project" | "user" = "project";
let selectedNumReviews = 1;

const mockCopilotInstallPlugin = mock(async () => ({ success: true }));
const mockCopilotDetectPlugin = mock(async () => null as "user" | null);

const mockAdapters = [
	{
		name: "github-copilot",
		isAvailable: async () => true,
		getProjectCommandDir: () => null,
		getUserCommandDir: () => null,
		getProjectSkillDir: () => ".github/skills",
		getUserSkillDir: () => null,
		getCommandExtension: () => ".md",
		canUseSymlink: () => false,
		transformCommand: (content: string) => content,
		supportsHooks: () => true,
		checkHealth: async () => ({ status: "healthy" as const }),
		detectPlugin: async (_projectRoot: string) => mockCopilotDetectPlugin(),
		installPlugin: async (_scope: "user" | "project") =>
			mockCopilotInstallPlugin(),
		getManualInstallInstructions: (_scope: "user" | "project") => [
			"gh copilot -- plugin install Codagent-AI/agent-validator",
		],
	},
];

mock.module("../../src/cli-adapters/index.js", () => ({
	getAllAdapters: () => mockAdapters,
	getProjectCommandAdapters: () => mockAdapters,
	getUserCommandAdapters: () => [],
	getAdapter: (name: string) => mockAdapters.find((a) => a.name === name),
	getValidCLITools: () => mockAdapters.map((a) => a.name),
	isUsageLimit: (output: string) =>
		output.toLowerCase().includes("usage limit"),
}));

mock.module("@inquirer/prompts", () => ({
	checkbox: async (opts: { message?: string }) => {
		if (opts.message?.includes("Development")) return selectedDevCliNames;
		return selectedReviewCliNames;
	},
	number: async () => selectedNumReviews,
	select: async (opts: { message?: string }) => {
		if (opts.message?.includes("Install scope")) return selectedInstallScope;
		return "yes";
	},
	confirm: async () => true,
}));

// Mock claude-cli to prevent real CLI calls
mock.module("../../src/plugin/claude-cli.js", () => ({
	addMarketplace: async () => ({ success: true }),
	installPlugin: async () => ({ success: true }),
	listPlugins: async () => [],
	updateMarketplace: async () => ({ success: true }),
	updatePlugin: async () => ({ success: true }),
}));

const { registerInitCommand } = await import("../../src/commands/init.js");

describe("init command with github-copilot", () => {
	let testDir: string;
	let originalCwd: string;
	let program: Command;
	let logs: string[];
	const originalConsoleLog = console.log;
	const originalConsoleWarn = console.warn;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "gauntlet-init-copilot-test-"),
		);
		program = new Command();
		registerInitCommand(program);
		logs = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		console.warn = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		originalCwd = process.cwd();
		process.chdir(testDir);
		selectedDevCliNames = ["github-copilot"];
		selectedReviewCliNames = ["github-copilot"];
		selectedInstallScope = "project";
		selectedNumReviews = 1;
		mockCopilotInstallPlugin.mockClear();
		mockCopilotDetectPlugin.mockClear();
		mockCopilotInstallPlugin.mockImplementation(async () => ({
			success: true,
		}));
		mockCopilotDetectPlugin.mockImplementation(async () => null);
	});

	afterEach(async () => {
		console.log = originalConsoleLog;
		console.warn = originalConsoleWarn;
		process.chdir(originalCwd);
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("prints /validator-setup instructions for github-copilot (NATIVE_CLIS)", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		expect(output).toContain("/validator-setup");
		expect(output).toContain(
			"configuring the static checks",
		);
	});

	it("installs plugin via installPlugin when not already installed", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		expect(mockCopilotInstallPlugin).toHaveBeenCalledTimes(1);
	});

	it("skips install when plugin already detected", async () => {
		mockCopilotDetectPlugin.mockImplementation(async () => "user" as const);

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		expect(output).toContain("already installed");
		expect(mockCopilotInstallPlugin).not.toHaveBeenCalled();
	});

	it("does NOT copy skills to .github/skills via file copy", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Skills should NOT be file-copied for github-copilot
		// (plugin mechanism is used instead)
		const skillsDir = path.join(testDir, ".github", "skills");
		const skillsDirExists = await fs
			.stat(skillsDir)
			.then(() => true)
			.catch(() => false);
		expect(skillsDirExists).toBe(false);
	});
});
