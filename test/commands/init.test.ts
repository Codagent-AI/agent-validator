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
let selectedReviewCliNameResponses: string[][] = [];
let selectedBuiltInReviews: string[] = ["code-quality", "security", "error-handling"];
let selectedInstallScope: "project" | "user" = "project";
let selectedNumReviews = 1;
let checkboxMessages: string[] = [];
let enableLocalAIReviews = true;
let localAIReviewOptOutConfirmed = true;

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
const updateAgentPluginForAgentsMock = mock(
	(_opts: { agents: string[]; scope?: "project" | "user"; yes?: boolean }) => {},
);
let confirmAgentPluginInstall = true;
let confirmAgentPluginInstallResponses: boolean[] = [];

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
		if (selectedReviewCliNameResponses.length > 0) {
			return selectedReviewCliNameResponses.shift() ?? selectedReviewCliNames;
		}
		return selectedReviewCliNames;
	},
	number: async () => selectedNumReviews,
	select: async (opts: { message?: string }) => {
		if (opts.message?.includes("Agent Validator install skills")) {
			return selectedInstallScope;
		}
		return "yes";
	},
	confirm: async (opts: { message?: string }) => {
		if (opts.message?.includes("Enable local AI reviews")) {
			return enableLocalAIReviews;
		}
		if (opts.message?.includes("Are you sure you want to skip local AI reviews")) {
			return localAIReviewOptOutConfirmed;
		}
		if (opts.message?.includes("Proceed with plugin installation")) {
			if (confirmAgentPluginInstallResponses.length > 0) {
				return confirmAgentPluginInstallResponses.shift() ?? confirmAgentPluginInstall;
			}
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
		registerInitCommand(program, {
			installAgentPluginForAgents: installAgentPluginForAgentsMock,
			updateAgentPluginForAgents: updateAgentPluginForAgentsMock,
		});
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
		selectedReviewCliNameResponses = [];
		selectedBuiltInReviews = ["code-quality", "security", "error-handling"];
		selectedInstallScope = "user";
		selectedNumReviews = 1;
		checkboxMessages = [];
		enableLocalAIReviews = true;
		localAIReviewOptOutConfirmed = true;
		confirmAgentPluginInstall = true;
		confirmAgentPluginInstallResponses = [];
		addMarketplaceMock.mockClear();
		installPluginMock.mockClear();
		listPluginsMock.mockClear();
		listPluginsMock.mockImplementation(async () => []);
		updateMarketplaceMock.mockClear();
		updatePluginMock.mockClear();
		installAgentPluginForAgentsMock.mockClear();
		updateAgentPluginForAgentsMock.mockClear();
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

	it("does not prompt for review CLIs or write review gates after confirmed local AI review opt-out", async () => {
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["codex"];
		enableLocalAIReviews = false;
		localAIReviewOptOutConfirmed = true;

		await program.parseAsync(["node", "test", "init"]);

		expect(checkboxMessages).toContain("Development CLIs:");
		expect(checkboxMessages).not.toContain("Review CLIs:");
		const configContent = await fs.readFile(
			path.join(testDir, ".validator", "config.yml"),
			"utf-8",
		);
		expect(configContent).toContain("entry_points:");
		expect(configContent).toContain("- path: .");
		expect(configContent).not.toContain("reviews:");
		expect(configContent).toContain("    - claude");
		expect(configContent).not.toContain("    - codex");
	});

	it("writes only requested opt-in built-ins after confirmed local AI review opt-out", async () => {
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["codex"];
		enableLocalAIReviews = false;
		localAIReviewOptOutConfirmed = true;

		await program.parseAsync([
			"node",
			"test",
			"init",
			"--enable-builtin",
			"task-compliance",
		]);

		expect(checkboxMessages).not.toContain("Review CLIs:");
		const configContent = await fs.readFile(
			path.join(testDir, ".validator", "config.yml"),
			"utf-8",
		);
		expect(configContent).toContain("reviews:");
		expect(configContent).toContain("task-compliance:");
		expect(configContent).toContain("builtin: task-compliance");
		expect(configContent).toContain(
			"enabled: false # Opt-in: activate with `agent-validator run --enable-review task-compliance --context-file <task>`",
		);
		expect(configContent).not.toContain("all-reviewers:");
		expect(configContent).not.toContain("code-quality:");
	});

	it("writes comma-separated opt-in built-ins once each", async () => {
		selectedDevCliNames = ["codex"];
		selectedReviewCliNames = ["codex"];

		await program.parseAsync([
			"node",
			"test",
			"init",
			"--enable-builtin",
			"task-compliance,test-integrity,task-compliance",
		]);

		const configContent = await fs.readFile(
			path.join(testDir, ".validator", "config.yml"),
			"utf-8",
		);
		expect(configContent.match(/task-compliance:/g)).toHaveLength(1);
		expect(configContent.match(/test-integrity:/g)).toHaveLength(1);
		expect(configContent).toContain("builtin: task-compliance");
		expect(configContent).toContain("builtin: test-integrity");
		expect(configContent).toContain(
			"--enable-review task-compliance --context-file <task>",
		);
		expect(configContent).toContain(
			"--enable-review test-integrity --context-file <task>",
		);
	});

	it("rejects unknown --enable-builtin names before scaffolding or plugin installation", async () => {
		await expect(
			program.parseAsync([
				"node",
				"test",
				"init",
				"--enable-builtin",
				"gibberish",
			]),
		).rejects.toThrow(
			"gibberish is not an opt-in built-in review. Accepted opt-in built-ins: task-compliance, test-integrity",
		);

		expect(await fs.stat(path.join(testDir, ".validator")).catch(() => null)).toBeNull();
		expect(installAgentPluginForAgentsMock).not.toHaveBeenCalled();
	});

	it("rejects primary built-in names for --enable-builtin", async () => {
		await expect(
			program.parseAsync([
				"node",
				"test",
				"init",
				"--enable-builtin",
				"code-quality",
			]),
		).rejects.toThrow(
			"code-quality is not an opt-in built-in review. Accepted opt-in built-ins: task-compliance, test-integrity",
		);
	});

	it("continues to reviewer CLI selection when local AI review opt-out is not confirmed", async () => {
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["codex"];
		enableLocalAIReviews = false;
		localAIReviewOptOutConfirmed = false;

		await program.parseAsync(["node", "test", "init"]);

		expect(checkboxMessages).toContain("Review CLIs:");
		const configContent = await fs.readFile(
			path.join(testDir, ".validator", "config.yml"),
			"utf-8",
		);
		expect(configContent).toContain("reviews:");
		expect(configContent).toContain("all-reviewers:");
		expect(configContent).toContain("    - codex");
	});

	it("writes the README-recommended Codex review adapter settings", async () => {
		selectedDevCliNames = ["codex"];
		selectedReviewCliNames = ["codex"];

		await program.parseAsync(["node", "test", "init"]);

		const configContent = await fs.readFile(
			path.join(testDir, ".validator", "config.yml"),
			"utf-8",
		);
		expect(configContent).toContain("    codex:");
		expect(configContent).toContain("      allow_tool_use: false");
		expect(configContent).toContain("      thinking_budget: medium");
		expect(configContent).toContain("all-reviewers:");
		expect(configContent).toContain("model: gpt-5.3-codex");
	});

	it("writes the README-recommended Copilot hybrid review config", async () => {
		selectedDevCliNames = ["github-copilot", "codex"];
		selectedReviewCliNames = ["github-copilot", "codex"];

		await program.parseAsync(["node", "test", "init"]);

		const configContent = await fs.readFile(
			path.join(testDir, ".validator", "config.yml"),
			"utf-8",
		);
		expect(configContent).toContain("    github-copilot:");
		expect(configContent).toContain("      thinking_budget: low");
		expect(configContent).toContain("    codex:");
		expect(configContent).toContain("      thinking_budget: medium");
		expect(configContent).toContain("code-quality:");
		expect(configContent).toContain("model: claude-sonnet-4.6");
		expect(configContent).toContain("security-and-errors:");
		expect(configContent).toContain("model: gpt-5.3-codex");
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

	it("does not write Claude local settings", async () => {
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

	it("explains agent-plugin dry-run output before printing it", async () => {
		selectedDevCliNames = ["claude"];
		selectedReviewCliNames = ["claude"];

		await program.parseAsync(["node", "test", "init"]);

		const output = logs.join("\n");
		expect(output).toContain(
			"Agent Validator will install the following skills and agent plugins:",
		);
		expect(installAgentPluginForAgentsMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ agents: ["claude"], dryRun: true }),
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

	it("returns to reviewer CLI selection when plugin installation is declined", async () => {
		selectedDevCliNames = ["claude"];
		selectedReviewCliNameResponses = [["claude"], ["cursor"]];
		confirmAgentPluginInstallResponses = [false, true];

		await program.parseAsync(["node", "test", "init"]);

		expect(checkboxMessages.filter((m) => m === "Review CLIs:")).toHaveLength(2);
		expect(installAgentPluginForAgentsMock).toHaveBeenCalledTimes(3);
		expect(installAgentPluginForAgentsMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				agents: ["claude"],
				scope: "user",
				dryRun: true,
			}),
		);
		expect(installAgentPluginForAgentsMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				agents: ["claude"],
				scope: "user",
				dryRun: true,
			}),
		);
		expect(installAgentPluginForAgentsMock).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				agents: ["claude"],
				scope: "user",
				yes: false,
			}),
		);
		const configContent = await fs.readFile(
			path.join(testDir, ".validator", "config.yml"),
			"utf-8",
		);
		expect(configContent).toContain("    - cursor");
		expect(configContent).not.toContain("    - claude");
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

	it("on re-run with --enable-builtin, warns with paste-ready YAML and leaves config unchanged", async () => {
		await fs.mkdir(path.join(testDir, ".validator"), { recursive: true });
		const configPath = path.join(testDir, ".validator", "config.yml");
		await fs.writeFile(configPath, "existing: true\n");
		listPluginsMock.mockImplementation(async () => [
			{ name: "agent-validator", scope: "project", projectPath: testDir },
		]);

		await program.parseAsync([
			"node",
			"test",
			"init",
			"--yes",
			"--enable-builtin",
			"task-compliance",
			"--enable-builtin",
			"test-integrity",
		]);

		expect(await fs.readFile(configPath, "utf-8")).toBe("existing: true\n");
		const output = logs.join("\n");
		expect(output).toContain(
			"Warning: --enable-builtin was passed but .validator/ already exists.",
		);
		expect(output).toContain(
			"The following entries were NOT added to .validator/config.yml: task-compliance, test-integrity.",
		);
		expect(output).toContain("      - task-compliance:");
		expect(output).toContain("      - test-integrity:");
		expect(output).toContain("          builtin: task-compliance");
		expect(output).toContain("          builtin: test-integrity");
		expect(output).toContain(
			"          enabled: false # Opt-in: activate with `agent-validator run --enable-review task-compliance --context-file <task>`",
		);
		expect(output).toContain("          num_reviews: 1");
	});

	it("on re-run with --enable-builtin and legacy .gauntlet/, warns using the actual dir name", async () => {
		await fs.mkdir(path.join(testDir, ".gauntlet"), { recursive: true });
		const configPath = path.join(testDir, ".gauntlet", "config.yml");
		await fs.writeFile(configPath, "existing: true\n");
		listPluginsMock.mockImplementation(async () => [
			{ name: "agent-validator", scope: "project", projectPath: testDir },
		]);

		await program.parseAsync([
			"node",
			"test",
			"init",
			"--yes",
			"--enable-builtin",
			"task-compliance",
		]);

		expect(await fs.readFile(configPath, "utf-8")).toBe("existing: true\n");
		const output = logs.join("\n");
		expect(output).toContain(
			"Warning: --enable-builtin was passed but .gauntlet/ already exists.",
		);
		expect(output).toContain(
			"The following entries were NOT added to .gauntlet/config.yml: task-compliance.",
		);
		expect(output).not.toContain(
			"Warning: --enable-builtin was passed but .validator/ already exists.",
		);
	});
});
