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

let selectedDevCliNames: string[] = ["claude", "codex", "gemini", "cursor"];
let selectedReviewCliNames: string[] = ["claude", "codex", "gemini", "cursor"];
let selectedInstallScope: "project" | "user" = "project";
let selectedNumReviews = 1;

const addMarketplaceMock = mock(async () => ({ success: true }));
const installPluginMock = mock(async (_scope: "project" | "user") => ({
	success: true,
}));
type PluginListEntry = {
	name?: string;
	scope?: string;
	projectPath?: string;
};
const listPluginsMock = mock(async () => [] as PluginListEntry[]);
const updateMarketplaceMock = mock(async () => ({ success: true }));
const updatePluginMock = mock(async () => ({ success: true }));

const mockAdapters = [
	{
		name: "claude",
		isAvailable: async () => true,
		getProjectCommandDir: () => ".claude/commands",
		getUserCommandDir: () => null,
		getProjectSkillDir: () => ".claude/skills",
		getUserSkillDir: () => null,
		getCommandExtension: () => ".md",
		canUseSymlink: () => true,
		transformCommand: (content: string) => content,
		supportsHooks: () => true,
		checkHealth: async () => ({ status: "healthy" as const }),
		detectPlugin: async (_projectRoot: string) => {
			const entries = await listPluginsMock();
			const pluginEntries = entries.filter(
				(e) => e.name === "agent-gauntlet" || e.name?.startsWith("agent-gauntlet@"),
			);
			if (pluginEntries.some((e) => e.scope === "project")) return "project" as const;
			if (pluginEntries.some((e) => e.scope === "user")) return "user" as const;
			return null;
		},
		installPlugin: async (scope: "user" | "project") => {
			const addResult = await addMarketplaceMock();
			if (!addResult.success)
				return { success: false, error: (addResult as { stderr?: string }).stderr };
			const installResult = await installPluginMock(scope);
			if (!installResult.success)
				return { success: false, error: (installResult as { stderr?: string }).stderr };
			return { success: true };
		},
		getManualInstallInstructions: (scope: "user" | "project") => [
			"claude plugin marketplace add pcaplan/agent-gauntlet",
			`claude plugin install agent-gauntlet --scope ${scope}`,
		],
	},
	{
		name: "cursor",
		isAvailable: async () => true,
		getProjectCommandDir: () => null,
		getUserCommandDir: () => null,
		getProjectSkillDir: () => ".cursor/skills",
		getUserSkillDir: () => null,
		getCommandExtension: () => ".md",
		canUseSymlink: () => true,
		transformCommand: (content: string) => content,
		supportsHooks: () => true,
		checkHealth: async () => ({ status: "healthy" as const }),
	},
	{
		name: "codex",
		isAvailable: async () => true,
		getProjectCommandDir: () => null,
		getUserCommandDir: () => null,
		getProjectSkillDir: () => ".agents/skills",
		getUserSkillDir: () => null,
		getCommandExtension: () => ".md",
		canUseSymlink: () => true,
		transformCommand: (content: string) => content,
		supportsHooks: () => false,
		checkHealth: async () => ({ status: "healthy" as const }),
	},
	{
		name: "gemini",
		isAvailable: async () => true,
		getProjectCommandDir: () => null,
		getUserCommandDir: () => null,
		getProjectSkillDir: () => ".claude/skills",
		getUserSkillDir: () => null,
		getCommandExtension: () => ".md",
		canUseSymlink: () => true,
		transformCommand: (content: string) => content,
		supportsHooks: () => false,
		checkHealth: async () => ({ status: "healthy" as const }),
	},
];

mock.module("../../src/cli-adapters/index.js", () => ({
	getAllAdapters: () => mockAdapters,
	getProjectCommandAdapters: () => mockAdapters,
	getUserCommandAdapters: () => [],
	getAdapter: (name: string) => mockAdapters.find((a) => a.name === name),
	getValidCLITools: () => mockAdapters.map((a) => a.name),
	isUsageLimit: (output: string) => output.toLowerCase().includes("usage limit"),
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

mock.module("../../src/plugin/claude-cli.js", () => ({
	addMarketplace: () => addMarketplaceMock(),
	installPlugin: (scope: "project" | "user") => installPluginMock(scope),
	listPlugins: () => listPluginsMock(),
	updateMarketplace: () => updateMarketplaceMock(),
	updatePlugin: () => updatePluginMock(),
}));

const { registerInitCommand } = await import("../../src/commands/init.js");

describe("init command plugin installation", () => {
	let testDir: string;
	let originalCwd: string;
	let originalHome: string | undefined;
	let program: Command;
	let logs: string[];
	const originalConsoleLog = console.log;
	const originalConsoleWarn = console.warn;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "gauntlet-init-test-"));
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
		originalHome = process.env.HOME;
		process.chdir(testDir);
		selectedDevCliNames = ["claude", "codex", "gemini", "cursor"];
		selectedReviewCliNames = ["claude", "codex", "gemini", "cursor"];
		selectedInstallScope = "project";
		selectedNumReviews = 1;
		addMarketplaceMock.mockClear();
		installPluginMock.mockClear();
		listPluginsMock.mockClear();
		listPluginsMock.mockImplementation(async () => []);
		updateMarketplaceMock.mockClear();
		updatePluginMock.mockClear();
	});

	afterEach(async () => {
		console.log = originalConsoleLog;
		console.warn = originalConsoleWarn;
		process.chdir(originalCwd);
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("uses project scope with --yes and installs Claude plugin when not already installed", async () => {
		listPluginsMock.mockImplementation(async () => []);
		await program.parseAsync(["node", "test", "init", "--yes"]);

		expect(addMarketplaceMock).toHaveBeenCalledTimes(1);
		expect(installPluginMock).toHaveBeenCalledWith("project");
	});

	it("uses selected user scope for Claude plugin install", async () => {
		selectedInstallScope = "user";
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["claude"];
		selectedNumReviews = 1;
		const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "gauntlet-home-"));
		process.env.HOME = fakeHome;

		await program.parseAsync(["node", "test", "init"]);

		expect(installPluginMock).toHaveBeenCalledWith("user");
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	it("warns and continues if marketplace add fails", async () => {
		addMarketplaceMock.mockImplementationOnce(async () => ({
			success: false,
			stderr: "marketplace unavailable",
		}));

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		expect(output).toContain("plugin installation failed");
		expect(output).toContain(
			"claude plugin marketplace add pcaplan/agent-gauntlet",
		);
		expect(output).toContain("claude plugin install agent-gauntlet --scope project");

		const codexSkill = path.join(
			testDir,
			".agents",
			"skills",
			"gauntlet-run",
			"SKILL.md",
		);
		expect((await fs.stat(codexSkill).catch(() => null))?.isFile()).toBe(true);
	});

	it("warns and continues if plugin install fails", async () => {
		installPluginMock.mockImplementationOnce(async () => ({
			success: false,
			stderr: "install error",
		}));

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		expect(output).toContain("plugin installation failed");
		expect(output).toContain("claude plugin install agent-gauntlet --scope project");

		const codexSkill = path.join(
			testDir,
			".agents",
			"skills",
			"gauntlet-check",
			"SKILL.md",
		);
		expect((await fs.stat(codexSkill).catch(() => null))?.isFile()).toBe(true);
	});

	it("does not write Claude hooks to settings.local.json", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const settingsPath = path.join(testDir, ".claude", "settings.local.json");
		expect(await fs.stat(settingsPath).catch(() => null)).toBeNull();
	});

	it("installs Codex skills locally when project scope is selected", async () => {
		selectedInstallScope = "project";
		await program.parseAsync(["node", "test", "init"]);

		const codexSkill = path.join(
			testDir,
			".agents",
			"skills",
			"gauntlet-status",
			"SKILL.md",
		);
		expect((await fs.stat(codexSkill).catch(() => null))?.isFile()).toBe(true);
	});

	it("installs Codex skills globally when user scope is selected", async () => {
		selectedInstallScope = "user";
		const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "gauntlet-home-"));
		process.env.HOME = fakeHome;

		await program.parseAsync(["node", "test", "init"]);

		const globalSkill = path.join(
			fakeHome,
			".agents",
			"skills",
			"gauntlet-help",
			"SKILL.md",
		);
		expect((await fs.stat(globalSkill).catch(() => null))?.isFile()).toBe(true);
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	it("keeps non-Claude behavior for Gemini/Cursor by copying .claude skills", async () => {
		selectedDevCliNames = ["gemini", "cursor"];

		await program.parseAsync(["node", "test", "init"]);

		expect(addMarketplaceMock).not.toHaveBeenCalled();
		expect(installPluginMock).not.toHaveBeenCalled();

		const skill = path.join(testDir, ".claude", "skills", "gauntlet-setup", "SKILL.md");
		expect((await fs.stat(skill).catch(() => null))?.isFile()).toBe(true);
	});

	it("skips scope prompt and install when plugin already installed at user scope", async () => {
		listPluginsMock.mockImplementation(async () => [
			{ name: "agent-gauntlet", scope: "user" },
		]);
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["claude"];
		selectedNumReviews = 1;

		await program.parseAsync(["node", "test", "init"]);

		const output = logs.join("\n");
		expect(output).toContain("already installed at user scope");
		expect(addMarketplaceMock).not.toHaveBeenCalled();
		expect(installPluginMock).not.toHaveBeenCalled();
	});

	it("on re-run with existing .gauntlet, delegates to plugin update logic", async () => {
		await fs.mkdir(path.join(testDir, ".gauntlet"), { recursive: true });
		listPluginsMock.mockImplementation(async () => [
			{ name: "agent-gauntlet", scope: "project", projectPath: testDir },
		]);

		await program.parseAsync(["node", "test", "init", "--yes"]);

		expect(listPluginsMock).toHaveBeenCalledTimes(1);
		expect(updateMarketplaceMock).toHaveBeenCalledTimes(1);
		expect(updatePluginMock).toHaveBeenCalledTimes(1);
		expect(addMarketplaceMock).not.toHaveBeenCalled();
		expect(installPluginMock).not.toHaveBeenCalled();
	});
});
