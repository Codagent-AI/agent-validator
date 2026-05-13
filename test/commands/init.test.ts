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
let selectedBuiltInReviews: string[] = ["code-quality", "security", "error-handling"];
let selectedInstallScope: "project" | "user" = "project";
let selectedNumReviews = 1;
let checkboxMessages: string[] = [];

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
const installAgentPluginForAgentsMock = mock(
	(_opts: {
		agents: string[];
		scope: "project" | "user";
		yes?: boolean;
		dryRun?: boolean;
	}) => {},
);
let confirmAgentPluginInstall = true;

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
				(e) => e.name === "agent-validator" || e.name?.startsWith("agent-validator@"),
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
			"claude plugin marketplace add Codagent-AI/agent-validator",
			`claude plugin install agent-validator --scope ${scope}`,
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
		if (opts.message) checkboxMessages.push(opts.message);
		if (opts.message?.includes("Development")) return selectedDevCliNames;
		if (opts.message?.includes("Built-in")) return selectedBuiltInReviews;
		return selectedReviewCliNames;
	},
	number: async () => selectedNumReviews,
	select: async (opts: { message?: string }) => {
		if (opts.message?.includes("Install scope")) return selectedInstallScope;
		return "yes";
	},
	confirm: async (opts: { message?: string }) => {
		if (opts.message?.includes("Proceed with plugin installation")) {
			return confirmAgentPluginInstall;
		}
		return true;
	},
}));

mock.module("../../src/plugin/claude-cli.js", () => ({
	addMarketplace: () => addMarketplaceMock(),
	installPlugin: (scope: "project" | "user") => installPluginMock(scope),
	listPlugins: () => listPluginsMock(),
	updateMarketplace: () => updateMarketplaceMock(),
	updatePlugin: () => updatePluginMock(),
}));

mock.module("../../src/plugin/agent-plugin-cli.js", () => ({
	installAgentPluginForAgents: (opts: {
		agents: string[];
		scope: "project" | "user";
		yes?: boolean;
		dryRun?: boolean;
	}) => installAgentPluginForAgentsMock(opts),
	updateAgentPluginForAgents: () => {},
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
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-init-test-"));
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
		selectedBuiltInReviews = ["code-quality", "security", "error-handling"];
		selectedInstallScope = "user";
		selectedNumReviews = 1;
		checkboxMessages = [];
		confirmAgentPluginInstall = true;
		addMarketplaceMock.mockClear();
		installPluginMock.mockClear();
		listPluginsMock.mockClear();
		listPluginsMock.mockImplementation(async () => []);
		updateMarketplaceMock.mockClear();
		updatePluginMock.mockClear();
		installAgentPluginForAgentsMock.mockClear();
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

	it("uses user scope with --yes and installs Claude plugin when not already installed", async () => {
		listPluginsMock.mockImplementation(async () => []);
		await program.parseAsync(["node", "test", "init", "--yes"]);

		expect(installAgentPluginForAgentsMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				agents: expect.arrayContaining(["claude", "codex", "cursor", "gemini"]),
				scope: "user",
				dryRun: true,
			}),
		);
		expect(installAgentPluginForAgentsMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				agents: expect.arrayContaining(["claude", "codex", "cursor", "gemini"]),
				scope: "user",
				yes: true,
			}),
		);
	});

	it("uses selected user scope for Claude plugin install", async () => {
		selectedInstallScope = "user";
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["claude"];
		selectedNumReviews = 1;
		const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "validator-home-"));
		process.env.HOME = fakeHome;

		await program.parseAsync(["node", "test", "init"]);

		expect(installAgentPluginForAgentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				agents: ["claude"],
				scope: "user",
			}),
		);
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	it("uses --agents for development CLIs while still prompting for review CLIs", async () => {
		selectedDevCliNames = ["gemini"];
		selectedReviewCliNames = ["cursor"];
		selectedNumReviews = 1;

		await program.parseAsync([
			"node",
			"test",
			"init",
			"--agents",
			"claude,codex",
		]);

		expect(checkboxMessages).not.toContain("Development CLIs:");
		expect(checkboxMessages).toContain("Review CLIs:");
		expect(installAgentPluginForAgentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				agents: expect.arrayContaining(["claude", "codex"]),
				scope: "user",
			}),
		);
		const configContent = await fs.readFile(
			path.join(testDir, ".validator", "config.yml"),
			"utf-8",
		);
		expect(configContent).toContain("    - cursor");
		expect(configContent).not.toContain("    - claude");
	});

	it("accepts space-separated --agents values", async () => {
		selectedReviewCliNames = ["claude"];

		await program.parseAsync([
			"node",
			"test",
			"init",
			"--agents",
			"claude",
			"codex",
		]);

		expect(installAgentPluginForAgentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				agents: expect.arrayContaining(["claude", "codex"]),
			}),
		);
	});

	it("rejects --agents names that were not detected", async () => {
		await expect(
			program.parseAsync(["node", "test", "init", "--agents", "missing-agent"]),
		).rejects.toThrow("Unknown or unavailable development agent");

		expect(installAgentPluginForAgentsMock).not.toHaveBeenCalled();
	});

	it("does not write Claude hooks to settings.local.json", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const settingsPath = path.join(testDir, ".claude", "settings.local.json");
		expect(await fs.stat(settingsPath).catch(() => null)).toBeNull();
	});

	it("delegates Codex fallback to agent-plugin even when project scope is selected", async () => {
		selectedInstallScope = "project";
		await program.parseAsync(["node", "test", "init"]);

		expect(installAgentPluginForAgentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				agents: expect.arrayContaining(["codex"]),
				scope: "project",
			}),
		);
	});

	it("delegates Codex fallback to agent-plugin when user scope is selected", async () => {
		selectedInstallScope = "user";
		const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "validator-home-"));
		process.env.HOME = fakeHome;

		await program.parseAsync(["node", "test", "init"]);

		expect(installAgentPluginForAgentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				agents: expect.arrayContaining(["codex"]),
				scope: "user",
			}),
		);
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	it("prints one generic validator-setup skill instruction without listing skill files", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		expect(output).toContain("run the validator-setup skill in your agent");
		expect(output).not.toContain("To complete setup in Codex");
		expect(output).not.toContain("Available Codex skills");
		expect(output).not.toContain("~/.agents/skills/validator-run/SKILL.md");
	});

	it("delegates Gemini/Cursor fallback to agent-plugin instead of copying skills", async () => {
		selectedDevCliNames = ["gemini", "cursor"];

		await program.parseAsync(["node", "test", "init"]);

		expect(addMarketplaceMock).not.toHaveBeenCalled();
		expect(installPluginMock).not.toHaveBeenCalled();
		expect(installAgentPluginForAgentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				agents: expect.arrayContaining(["gemini", "cursor"]),
			}),
		);
	});

	it("passes selected agents to agent-plugin even when adapter detection would find an existing install", async () => {
		listPluginsMock.mockImplementation(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["claude"];
		selectedNumReviews = 1;

		await program.parseAsync(["node", "test", "init"]);

		const output = logs.join("\n");
		expect(addMarketplaceMock).not.toHaveBeenCalled();
		expect(installPluginMock).not.toHaveBeenCalled();
		expect(output).not.toContain("already installed at user scope");
		expect(installAgentPluginForAgentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				agents: ["claude"],
				scope: "user",
			}),
		);
	});

	it("runs agent-plugin dry-run and skips install when confirmation is declined", async () => {
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["claude"];
		confirmAgentPluginInstall = false;

		await program.parseAsync(["node", "test", "init"]);

		expect(installAgentPluginForAgentsMock).toHaveBeenCalledTimes(1);
		expect(installAgentPluginForAgentsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agents: ["claude"],
				scope: "user",
				dryRun: true,
			}),
		);
	});

	it("on re-run with existing .validator, delegates to plugin update logic", async () => {
		await fs.mkdir(path.join(testDir, ".validator"), { recursive: true });
		listPluginsMock.mockImplementation(async () => [
			{ name: "agent-validator", scope: "project", projectPath: testDir },
		]);

		await program.parseAsync(["node", "test", "init", "--yes"]);

		expect(listPluginsMock).toHaveBeenCalledTimes(1);
		expect(updateMarketplaceMock).toHaveBeenCalledTimes(1);
		expect(updatePluginMock).toHaveBeenCalledTimes(1);
		expect(addMarketplaceMock).not.toHaveBeenCalled();
		expect(installPluginMock).not.toHaveBeenCalled();
	});
});
