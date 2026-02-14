import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";

const TEST_DIR = path.join(process.cwd(), `test-init-${Date.now()}`);

/**
 * Shared cleanup: restore console.log, cwd, and remove test artifacts.
 */
async function cleanupTestEnv(
	originalConsoleLog: typeof console.log,
	originalCwd: string,
	dirs: string[],
): Promise<void> {
	console.log = originalConsoleLog;
	process.chdir(originalCwd);
	for (const dir of dirs) {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

// Mock adapters — "claude" must be present for --yes to install commands
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
	},
	{
		name: "mock-cli-2",
		isAvailable: async () => false, // Not available
		getProjectCommandDir: () => ".mock2",
		getUserCommandDir: () => null,
		getProjectSkillDir: () => null,
		getUserSkillDir: () => null,
		getCommandExtension: () => ".sh",
		canUseSymlink: () => false,
		transformCommand: (content: string) => content,
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

// Import after mocking
const { registerInitCommand, installStopHook, installCursorStopHook } =
	await import("../../src/commands/init.js");

describe("Init Command", () => {
	let program: Command;
	const originalConsoleLog = console.log;
	const originalCwd = process.cwd();
	let logs: string[];

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	beforeEach(() => {
		program = new Command();
		registerInitCommand(program);
		logs = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		process.chdir(TEST_DIR);
	});

	afterEach(() =>
		cleanupTestEnv(originalConsoleLog, originalCwd, [
			path.join(TEST_DIR, ".gauntlet"),
			path.join(TEST_DIR, ".claude"),
			path.join(TEST_DIR, ".gitignore"),
		]),
	);

	it("should register the init command", () => {
		const initCmd = program.commands.find((cmd) => cmd.name() === "init");
		expect(initCmd).toBeDefined();
		expect(initCmd?.description()).toBe("Initialize .gauntlet configuration");
		expect(initCmd?.options.some((opt) => opt.long === "--yes")).toBe(true);
	});

	it("should create .gauntlet directory structure with --yes flag", async () => {
		// We expect it to use the available mock-cli-1
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Check that files were created
		const gauntletDir = path.join(TEST_DIR, ".gauntlet");
		const configFile = path.join(gauntletDir, "config.yml");
		const reviewsDir = path.join(gauntletDir, "reviews");
		const checksDir = path.join(gauntletDir, "checks");
		const statusScriptDir = path.join(
			gauntletDir,
			"skills",
			"gauntlet",
			"status",
			"scripts",
		);

		expect(await fs.stat(gauntletDir)).toBeDefined();
		expect(await fs.stat(configFile)).toBeDefined();
		expect(await fs.stat(reviewsDir)).toBeDefined();
		expect(await fs.stat(checksDir)).toBeDefined();
		expect(await fs.stat(statusScriptDir)).toBeDefined();

		// Verify config content
		const configContent = await fs.readFile(configFile, "utf-8");
		expect(configContent).toContain("base_branch");
		expect(configContent).toContain("log_dir");
		expect(configContent).toContain("claude"); // Should be present
		expect(configContent).not.toContain("mock-cli-2"); // Should not be present (unavailable)

		// Verify YAML review file was created
		const reviewFiles = await fs.readdir(reviewsDir);
		expect(reviewFiles).toContain("code-quality.yml");
		const reviewContent = await fs.readFile(
			path.join(reviewsDir, "code-quality.yml"),
			"utf-8",
		);
		expect(reviewContent).toContain("builtin: code-quality");
		expect(reviewContent).toContain("num_reviews: 1");

		// Verify entry_points configuration
		expect(configContent).toContain("entry_points: []");
		expect(configContent).toContain(
			"# entry_points configured by /gauntlet-setup",
		);
	});

	it("should not create directory if .gauntlet already exists", async () => {
		// Create .gauntlet directory first
		const gauntletDir = path.join(TEST_DIR, ".gauntlet");
		await fs.mkdir(gauntletDir, { recursive: true });

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		expect(output).toContain(".gauntlet directory already exists");
	});

	it("should create config with empty entry_points", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const configContent = await fs.readFile(
			path.join(TEST_DIR, ".gauntlet", "config.yml"),
			"utf-8",
		);
		expect(configContent).toContain("entry_points: []");
		expect(configContent).toContain(
			"# entry_points configured by /gauntlet-setup",
		);
	});

	it("should create reviews/code-quality.yml with num_reviews: 1", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const reviewContent = await fs.readFile(
			path.join(TEST_DIR, ".gauntlet", "reviews", "code-quality.yml"),
			"utf-8",
		);
		expect(reviewContent).toContain("num_reviews: 1");
		expect(reviewContent).toContain("builtin: code-quality");
	});

	it("should print next-step message", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const output = logs.join("\n");
		expect(output).toContain("/gauntlet-setup");
	});

	it("should not prompt for base branch, lint, or test commands", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const output = logs.join("\n");
		expect(output).not.toContain("base branch");
		expect(output).not.toContain("lint command");
		expect(output).not.toContain("test command");
	});

	it("should auto-detect base branch with fallback to origin/main", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const configContent = await fs.readFile(
			path.join(TEST_DIR, ".gauntlet", "config.yml"),
			"utf-8",
		);
		// Should have some base_branch set (either auto-detected or fallback)
		expect(configContent).toMatch(/base_branch: origin\//);
	});

	it("should add gauntlet_logs to .gitignore", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const content = await fs.readFile(
			path.join(TEST_DIR, ".gitignore"),
			"utf-8",
		);
		expect(content).toContain("gauntlet_logs");
	});

	it("should append to existing .gitignore without duplicating", async () => {
		await fs.writeFile(
			path.join(TEST_DIR, ".gitignore"),
			"node_modules\n",
		);
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const content = await fs.readFile(
			path.join(TEST_DIR, ".gitignore"),
			"utf-8",
		);
		expect(content).toContain("node_modules");
		expect(content).toContain("gauntlet_logs");
	});

	it("should not duplicate gauntlet_logs if already in .gitignore", async () => {
		await fs.writeFile(
			path.join(TEST_DIR, ".gitignore"),
			"node_modules\ngauntlet_logs\n",
		);
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const content = await fs.readFile(
			path.join(TEST_DIR, ".gitignore"),
			"utf-8",
		);
		const matches = content.match(/gauntlet_logs/g);
		expect(matches?.length).toBe(1);
	});
});

describe("Stop Hook Installation", () => {
	const originalConsoleLog = console.log;
	const originalCwd = process.cwd();
	let logs: string[];

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	beforeEach(() => {
		logs = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		process.chdir(TEST_DIR);
	});

	afterEach(() =>
		cleanupTestEnv(originalConsoleLog, originalCwd, [
			path.join(TEST_DIR, ".claude"),
		]),
	);

	describe("Settings File Creation", () => {
		it("should create .claude/ directory if it doesn't exist", async () => {
			await installStopHook(TEST_DIR);

			const claudeDir = path.join(TEST_DIR, ".claude");
			const stat = await fs.stat(claudeDir);
			expect(stat.isDirectory()).toBe(true);
		});

		it("should create settings.local.json in existing .claude/ directory", async () => {
			// Pre-create .claude directory
			await fs.mkdir(path.join(TEST_DIR, ".claude"), { recursive: true });

			await installStopHook(TEST_DIR);

			const settingsPath = path.join(
				TEST_DIR,
				".claude",
				"settings.local.json",
			);
			const stat = await fs.stat(settingsPath);
			expect(stat.isFile()).toBe(true);
		});

		it("should merge with existing settings.local.json", async () => {
			// Pre-create .claude directory with existing settings
			await fs.mkdir(path.join(TEST_DIR, ".claude"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".claude", "settings.local.json"),
				JSON.stringify({
					someOtherSetting: "value",
					hooks: {
						PreToolUse: [{ type: "command", command: "echo test" }],
					},
				}),
			);

			await installStopHook(TEST_DIR);

			const settingsPath = path.join(
				TEST_DIR,
				".claude",
				"settings.local.json",
			);
			const content = await fs.readFile(settingsPath, "utf-8");
			const settings = JSON.parse(content);

			// Should preserve existing settings
			expect(settings.someOtherSetting).toBe("value");
			// Should preserve existing hooks
			expect(settings.hooks.PreToolUse).toBeDefined();
			// Should add Stop hooks
			expect(settings.hooks.Stop).toBeDefined();
		});
	});

	describe("Hook Configuration Content", () => {
		it("should have hooks.Stop array with command hook", async () => {
			await installStopHook(TEST_DIR);

			const settingsPath = path.join(
				TEST_DIR,
				".claude",
				"settings.local.json",
			);
			const content = await fs.readFile(settingsPath, "utf-8");
			const settings = JSON.parse(content);

			expect(Array.isArray(settings.hooks.Stop)).toBe(true);
			expect(settings.hooks.Stop.length).toBeGreaterThan(0);

			// Check the structure of the first hook
			const firstHook = settings.hooks.Stop[0];
			expect(firstHook.hooks).toBeDefined();
			expect(Array.isArray(firstHook.hooks)).toBe(true);
		});

		it("should set command to 'agent-gauntlet stop-hook'", async () => {
			await installStopHook(TEST_DIR);

			const settingsPath = path.join(
				TEST_DIR,
				".claude",
				"settings.local.json",
			);
			const content = await fs.readFile(settingsPath, "utf-8");
			const settings = JSON.parse(content);

			const innerHook = settings.hooks.Stop[0].hooks[0];
			expect(innerHook.command).toBe("agent-gauntlet stop-hook");
		});

		it("should set timeout to 300 seconds", async () => {
			await installStopHook(TEST_DIR);

			const settingsPath = path.join(
				TEST_DIR,
				".claude",
				"settings.local.json",
			);
			const content = await fs.readFile(settingsPath, "utf-8");
			const settings = JSON.parse(content);

			const innerHook = settings.hooks.Stop[0].hooks[0];
			expect(innerHook.timeout).toBe(300);
		});

		it("should set type to 'command'", async () => {
			await installStopHook(TEST_DIR);

			const settingsPath = path.join(
				TEST_DIR,
				".claude",
				"settings.local.json",
			);
			const content = await fs.readFile(settingsPath, "utf-8");
			const settings = JSON.parse(content);

			const innerHook = settings.hooks.Stop[0].hooks[0];
			expect(innerHook.type).toBe("command");
		});

		it("should output properly formatted JSON (indented)", async () => {
			await installStopHook(TEST_DIR);

			const settingsPath = path.join(
				TEST_DIR,
				".claude",
				"settings.local.json",
			);
			const content = await fs.readFile(settingsPath, "utf-8");

			// Should be formatted with indentation (not a single line)
			expect(content.includes("\n")).toBe(true);
			// Should have 2-space indentation (default for JSON.stringify(x, null, 2))
			expect(content.includes('  "hooks"')).toBe(true);
		});
	});

	describe("Installation Feedback", () => {
		it("should show confirmation message on successful installation", async () => {
			await installStopHook(TEST_DIR);

			const output = logs.join("\n");
			expect(output).toContain("Stop hook installed");
			expect(output).toContain(
				"gauntlet will run automatically when agent stops",
			);
		});
	});
});

describe("Cursor Stop Hook Installation", () => {
	const originalConsoleLog = console.log;
	const originalCwd = process.cwd();
	let logs: string[];

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	beforeEach(() => {
		logs = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		process.chdir(TEST_DIR);
	});

	afterEach(() =>
		cleanupTestEnv(originalConsoleLog, originalCwd, [
			path.join(TEST_DIR, ".cursor"),
		]),
	);

	it("should create .cursor/ directory if it doesn't exist", async () => {
		await installCursorStopHook(TEST_DIR);
		const cursorDir = path.join(TEST_DIR, ".cursor");
		const stat = await fs.stat(cursorDir);
		expect(stat.isDirectory()).toBe(true);
	});

	it("should create hooks.json with correct format", async () => {
		await installCursorStopHook(TEST_DIR);
		const hooksPath = path.join(TEST_DIR, ".cursor", "hooks.json");
		const content = await fs.readFile(hooksPath, "utf-8");
		const config = JSON.parse(content);
		expect(config.version).toBe(1);
		expect(Array.isArray(config.hooks.stop)).toBe(true);
		expect(config.hooks.stop.length).toBe(1);
		expect(config.hooks.stop[0].command).toBe("agent-gauntlet stop-hook");
		expect(config.hooks.stop[0].loop_limit).toBe(10);
	});

	it("should merge with existing hooks.json", async () => {
		await fs.mkdir(path.join(TEST_DIR, ".cursor"), { recursive: true });
		await fs.writeFile(
			path.join(TEST_DIR, ".cursor", "hooks.json"),
			JSON.stringify({
				version: 1,
				hooks: {
					start: [{ command: "echo hello" }],
				},
			}),
		);

		await installCursorStopHook(TEST_DIR);

		const hooksPath = path.join(TEST_DIR, ".cursor", "hooks.json");
		const content = await fs.readFile(hooksPath, "utf-8");
		const config = JSON.parse(content);
		// Should preserve existing hooks
		expect(config.hooks.start).toBeDefined();
		expect(config.hooks.start[0].command).toBe("echo hello");
		// Should add stop hooks
		expect(config.hooks.stop).toBeDefined();
		expect(config.hooks.stop[0].command).toBe("agent-gauntlet stop-hook");
	});

	it("should skip if already installed", async () => {
		await fs.mkdir(path.join(TEST_DIR, ".cursor"), { recursive: true });
		await fs.writeFile(
			path.join(TEST_DIR, ".cursor", "hooks.json"),
			JSON.stringify({
				version: 1,
				hooks: {
					stop: [{ command: "agent-gauntlet stop-hook", loop_limit: 10 }],
				},
			}),
		);

		await installCursorStopHook(TEST_DIR);

		const output = logs.join("\n");
		expect(output).toContain("already installed");
		// Should not duplicate
		const content = await fs.readFile(
			path.join(TEST_DIR, ".cursor", "hooks.json"),
			"utf-8",
		);
		const config = JSON.parse(content);
		expect(config.hooks.stop.length).toBe(1);
	});

	it("should output properly formatted JSON", async () => {
		await installCursorStopHook(TEST_DIR);
		const hooksPath = path.join(TEST_DIR, ".cursor", "hooks.json");
		const content = await fs.readFile(hooksPath, "utf-8");
		expect(content.includes("\n")).toBe(true);
		expect(content.includes('  "version"')).toBe(true);
	});
});

describe("Skills Migration", () => {
	let program: Command;
	const originalConsoleLog = console.log;
	const originalCwd = process.cwd();
	let logs: string[];

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	beforeEach(() => {
		program = new Command();
		registerInitCommand(program);
		logs = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		process.chdir(TEST_DIR);
	});

	afterEach(() =>
		cleanupTestEnv(originalConsoleLog, originalCwd, [
			path.join(TEST_DIR, ".gauntlet"),
			path.join(TEST_DIR, ".claude"),
		]),
	);

	it("should copy status script bundle into .gauntlet/", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Script may or may not exist depending on bundled file availability
		// but the directory should be created
		const dirPath = path.join(
			TEST_DIR,
			".gauntlet",
			"skills",
			"gauntlet",
			"status",
			"scripts",
		);
		const stat = await fs.stat(dirPath);
		expect(stat.isDirectory()).toBe(true);
	});

	it("should only install commands to .claude/skills, not other adapter dirs", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Claude skills should be created
		const claudeSkillsDir = path.join(TEST_DIR, ".claude", "skills");
		const stat = await fs.stat(claudeSkillsDir);
		expect(stat.isDirectory()).toBe(true);

		// No other adapter directories should be created
		const mock2Exists = await fs
			.stat(path.join(TEST_DIR, ".mock2"))
			.catch(() => null);
		expect(mock2Exists).toBeNull();
	});
});

describe("Skills Installation for Claude", () => {
	const originalConsoleLog = console.log;
	const originalCwd = process.cwd();
	let logs: string[];
	let program: Command;

	// Override mock adapters to include a Claude adapter with skills
	const claudeMockAdapters = [
		{
			name: "claude",
			isAvailable: async () => true,
			getProjectCommandDir: () => ".claude-mock/commands",
			getUserCommandDir: () => null,
			getProjectSkillDir: () => ".claude-mock/skills",
			getUserSkillDir: () => null,
			getCommandExtension: () => ".md",
			canUseSymlink: () => true,
			transformCommand: (content: string) => content,
		},
		{
			name: "other-mock",
			isAvailable: async () => true,
			getProjectCommandDir: () => ".other-mock",
			getUserCommandDir: () => null,
			getProjectSkillDir: () => null,
			getUserSkillDir: () => null,
			getCommandExtension: () => ".md",
			canUseSymlink: () => false,
			transformCommand: (content: string) => content,
		},
	];

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		// Override mock adapters temporarily
		mockAdapters.length = 0;
		mockAdapters.push(...(claudeMockAdapters as typeof mockAdapters));
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		// Restore original mock adapters
		mockAdapters.length = 0;
		mockAdapters.push(
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
			},
			{
				name: "mock-cli-2",
				isAvailable: async () => false,
				getProjectCommandDir: () => ".mock2",
				getUserCommandDir: () => null,
				getProjectSkillDir: () => null,
				getUserSkillDir: () => null,
				getCommandExtension: () => ".sh",
				canUseSymlink: () => false,
				transformCommand: (content: string) => content,
			},
		);
	});

	beforeEach(() => {
		program = new Command();
		registerInitCommand(program);
		logs = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		process.chdir(TEST_DIR);
	});

	afterEach(() =>
		cleanupTestEnv(originalConsoleLog, originalCwd, [
			path.join(TEST_DIR, ".gauntlet"),
			path.join(TEST_DIR, ".claude-mock"),
			path.join(TEST_DIR, ".other-mock"),
		]),
	);

	it("should install Claude skills as SKILL.md files under .claude/skills/gauntlet-*/", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const skillsDir = path.join(TEST_DIR, ".claude-mock", "skills");
		const actions = ["run", "check", "push-pr", "fix-pr", "status", "help", "setup"];

		for (const action of actions) {
			const skillPath = path.join(skillsDir, `gauntlet-${action}`, "SKILL.md");
			const stat = await fs.stat(skillPath);
			expect(stat.isFile()).toBe(true);

			// Should have valid YAML frontmatter
			const content = await fs.readFile(skillPath, "utf-8");
			expect(content.startsWith("---\n")).toBe(true);
			expect(content).toContain("name:");
			expect(content).toContain("description:");
			expect(content).toContain("allowed-tools:");
		}
	});

	it("should reference agent-gauntlet check in gauntlet-check SKILL.md", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const checkPath = path.join(
			TEST_DIR,
			".claude-mock",
			"skills",
			"gauntlet-check",
			"SKILL.md",
		);
		const content = await fs.readFile(checkPath, "utf-8");

		expect(content).toContain("agent-gauntlet check");
	});

	it("should set correct frontmatter for all skills", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const skillsBase = path.join(TEST_DIR, ".claude-mock", "skills");

		for (const action of ["run", "check", "push-pr", "fix-pr", "status"]) {
			const content = await fs.readFile(
				path.join(skillsBase, `gauntlet-${action}`, "SKILL.md"),
				"utf-8",
			);
			expect(content).toContain(`name: gauntlet-${action}`);
			expect(content).toContain("disable-model-invocation: true");
		}
	});

	it("should not install commands for non-Claude adapters", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// other-mock should NOT get any command files (only claude is installed)
		const otherDirExists = await fs
			.stat(path.join(TEST_DIR, ".other-mock"))
			.catch(() => null);
		expect(otherDirExists).toBeNull();
	});

	it("should install gauntlet-help SKILL.md for Claude", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const helpSkillPath = path.join(
			TEST_DIR,
			".claude-mock",
			"skills",
			"gauntlet-help",
			"SKILL.md",
		);
		const stat = await fs.stat(helpSkillPath);
		expect(stat.isFile()).toBe(true);

		const content = await fs.readFile(helpSkillPath, "utf-8");
		expect(content).toContain("name: gauntlet-help");
		expect(content).toContain("diagnosis-only");
		expect(content).toContain("Evidence Sources");
		expect(content).toContain("Routing Logic");
		expect(content).toContain("Output Contract");
	});

	it("should install all 6 reference files for gauntlet-help", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const refsDir = path.join(
			TEST_DIR,
			".claude-mock",
			"skills",
			"gauntlet-help",
			"references",
		);
		const expectedFiles = [
			"stop-hook-troubleshooting.md",
			"config-troubleshooting.md",
			"gate-troubleshooting.md",
			"lock-troubleshooting.md",
			"adapter-troubleshooting.md",
			"ci-pr-troubleshooting.md",
		];

		const files = await fs.readdir(refsDir);
		for (const expected of expectedFiles) {
			expect(files).toContain(expected);
			const filePath = path.join(refsDir, expected);
			const stat = await fs.stat(filePath);
			expect(stat.isFile()).toBe(true);
			// Each reference file should have content
			const content = await fs.readFile(filePath, "utf-8");
			expect(content.length).toBeGreaterThan(100);
		}
		expect(files.length).toBe(6);
	});

	it("should not create directories for non-Claude adapters", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// other-mock should NOT have any directory created
		const otherDirExists = await fs
			.stat(path.join(TEST_DIR, ".other-mock"))
			.catch(() => null);
		expect(otherDirExists).toBeNull();
	});

	it("should preserve existing Claude skill files", async () => {
		// Pre-create a skill with existing content
		const existingDir = path.join(
			TEST_DIR,
			".claude-mock",
			"skills",
			"gauntlet-run",
		);
		await fs.mkdir(existingDir, { recursive: true });
		await fs.writeFile(
			path.join(existingDir, "SKILL.md"),
			"# My custom run skill",
		);

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const content = await fs.readFile(
			path.join(existingDir, "SKILL.md"),
			"utf-8",
		);
		expect(content).toBe("# My custom run skill");
	});

	it("should install gauntlet-setup SKILL.md for Claude", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const setupSkillPath = path.join(
			TEST_DIR,
			".claude-mock",
			"skills",
			"gauntlet-setup",
			"SKILL.md",
		);
		const stat = await fs.stat(setupSkillPath);
		expect(stat.isFile()).toBe(true);

		const content = await fs.readFile(setupSkillPath, "utf-8");
		expect(content).toContain("name: gauntlet-setup");
		expect(content).toContain("Scan project");
	});

	it("should install reference files for gauntlet-setup", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const refsDir = path.join(
			TEST_DIR,
			".claude-mock",
			"skills",
			"gauntlet-setup",
			"references",
		);

		const catalog = await fs.readFile(
			path.join(refsDir, "check-catalog.md"),
			"utf-8",
		);
		expect(catalog.length).toBeGreaterThan(100);
		expect(catalog).toContain("build");
		expect(catalog).toContain("lint");

		const structure = await fs.readFile(
			path.join(refsDir, "project-structure.md"),
			"utf-8",
		);
		expect(structure.length).toBeGreaterThan(100);
		expect(structure).toContain("Monorepo");
		expect(structure).toContain("wildcard");
	});

	it("should not install gauntlet-setup for non-Claude adapters", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// other-mock should NOT get any files
		const otherDirExists = await fs
			.stat(path.join(TEST_DIR, ".other-mock"))
			.catch(() => null);
		expect(otherDirExists).toBeNull();
	});

	it("should preserve existing gauntlet-setup skill files", async () => {
		const existingDir = path.join(
			TEST_DIR,
			".claude-mock",
			"skills",
			"gauntlet-setup",
		);
		await fs.mkdir(existingDir, { recursive: true });
		await fs.writeFile(
			path.join(existingDir, "SKILL.md"),
			"# My custom setup skill",
		);

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const content = await fs.readFile(
			path.join(existingDir, "SKILL.md"),
			"utf-8",
		);
		expect(content).toBe("# My custom setup skill");
	});
});
