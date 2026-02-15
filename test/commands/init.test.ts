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
 * Read and parse the hook config file for a given adapter variant.
 */
async function readHookConfig(
	testDir: string,
	variant: "claude" | "cursor",
): Promise<Record<string, unknown>> {
	const filePath =
		variant === "claude"
			? path.join(testDir, ".claude", "settings.local.json")
			: path.join(testDir, ".cursor", "hooks.json");
	const content = await fs.readFile(filePath, "utf-8");
	return JSON.parse(content) as Record<string, unknown>;
}

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
		supportsHooks: () => true,
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
		supportsHooks: () => false,
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
const { registerInitCommand, installStopHook, installCursorStopHook, mergeHookConfig, installStartHook, installCursorStartHook } =
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

	it("should not overwrite config when .gauntlet already exists but still install skills", async () => {
		// Create .gauntlet directory with a config file
		const gauntletDir = path.join(TEST_DIR, ".gauntlet");
		await fs.mkdir(gauntletDir, { recursive: true });
		await fs.writeFile(
			path.join(gauntletDir, "config.yml"),
			"# custom config\n",
		);

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		// Phase 4 skipped
		expect(output).toContain(".gauntlet/ already exists, skipping scaffolding");

		// Config was NOT overwritten
		const configContent = await fs.readFile(
			path.join(gauntletDir, "config.yml"),
			"utf-8",
		);
		expect(configContent).toBe("# custom config\n");

		// Phase 5 still ran — skills were installed
		const skillsDir = path.join(TEST_DIR, ".claude", "skills");
		const stat = await fs.stat(skillsDir).catch(() => null);
		expect(stat).not.toBeNull();
	});

	it("should not exit early when .gauntlet/ already exists (re-runnable)", async () => {
		// Create .gauntlet directory first
		const gauntletDir = path.join(TEST_DIR, ".gauntlet");
		await fs.mkdir(gauntletDir, { recursive: true });

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		// Should NOT exit early — should still run Phase 5 and 6
		expect(output).toContain(".gauntlet/ already exists, skipping scaffolding");
		// Phase 5: skills installed
		expect(output).toContain("Created .claude/skills/gauntlet-run/SKILL.md");
		// Phase 6: instructions printed
		expect(output).toContain("/gauntlet-setup");
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

	it("should announce built-in code quality reviewer", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const output = logs.join("\n");
		expect(output).toContain(
			"Agent Gauntlet's built-in code quality reviewer will be installed.",
		);
	});

	it("should print context-aware instructions for native CLIs", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const output = logs.join("\n");
		// Claude is a native CLI, should get /gauntlet-setup instruction
		expect(output).toContain(
			"Run /gauntlet-setup to configure your checks and reviews",
		);
	});

	it("should set num_reviews based on review CLI count with --yes", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);
		const reviewContent = await fs.readFile(
			path.join(TEST_DIR, ".gauntlet", "reviews", "code-quality.yml"),
			"utf-8",
		);
		// With --yes and 1 detected CLI, promptNumReviews returns count (1)
		expect(reviewContent).toContain("num_reviews: 1");
	});

	it("should update skill when checksum differs and --yes is passed", async () => {
		// Pre-create skill dir with stale content
		const skillDir = path.join(
			TEST_DIR,
			".claude",
			"skills",
			"gauntlet-run",
		);
		await fs.mkdir(skillDir, { recursive: true });
		await fs.writeFile(
			path.join(skillDir, "SKILL.md"),
			"# outdated content",
		);

		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Skill should have been updated (checksum mismatch + --yes = auto-overwrite)
		const content = await fs.readFile(
			path.join(skillDir, "SKILL.md"),
			"utf-8",
		);
		expect(content).not.toBe("# outdated content");
		expect(content).toContain("gauntlet-run");

		const output = logs.join("\n");
		expect(output).toContain("Updated .claude/skills/gauntlet-run/SKILL.md");
	});

	it("should skip skill when checksum matches", async () => {
		// First run: install skills
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Record skill content
		const skillDir = path.join(
			TEST_DIR,
			".claude",
			"skills",
			"gauntlet-run",
		);
		const contentBefore = await fs.readFile(
			path.join(skillDir, "SKILL.md"),
			"utf-8",
		);

		// Reset logs and .gauntlet for second run
		logs = [];
		await fs.rm(path.join(TEST_DIR, ".gauntlet"), {
			recursive: true,
			force: true,
		});
		await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });

		// Re-create program for second parse
		program = new Command();
		registerInitCommand(program);

		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Skill should still have same content (not updated since checksums match)
		const contentAfter = await fs.readFile(
			path.join(skillDir, "SKILL.md"),
			"utf-8",
		);
		expect(contentAfter).toBe(contentBefore);

		// Should NOT see "Updated" or "Created" for this skill
		const output = logs.join("\n");
		expect(output).not.toContain(
			"Updated .claude/skills/gauntlet-run/SKILL.md",
		);
		expect(output).not.toContain(
			"Created .claude/skills/gauntlet-run/SKILL.md",
		);
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

describe("Claude Start Hook Installation", () => {
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

	it("should create SessionStart hook in new settings file", async () => {
		await installStartHook(TEST_DIR);

		const settingsPath = path.join(
			TEST_DIR,
			".claude",
			"settings.local.json",
		);
		const content = await fs.readFile(settingsPath, "utf-8");
		const settings = JSON.parse(content);

		expect(Array.isArray(settings.hooks.SessionStart)).toBe(true);
		expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);

		const entry = settings.hooks.SessionStart[0];
		const innerHook = entry.hooks[0];
		expect(innerHook.command).toBe("agent-gauntlet start-hook");
		expect(innerHook.type).toBe("command");
	});

	it("should set start hook as synchronous", async () => {
		await installStartHook(TEST_DIR);
		const settings = await readHookConfig(TEST_DIR, "claude");
		const hooks = settings.hooks as Record<string, unknown[]>;
		const entry = hooks.SessionStart[0] as Record<string, unknown>;
		const innerHooks = entry.hooks as Record<string, unknown>[];
		expect(innerHooks[0].async).toBe(false);
	});

	it("should set matcher for session start events", async () => {
		await installStartHook(TEST_DIR);

		const settingsPath = path.join(
			TEST_DIR,
			".claude",
			"settings.local.json",
		);
		const content = await fs.readFile(settingsPath, "utf-8");
		const settings = JSON.parse(content);

		const matcher = settings.hooks.SessionStart[0].matcher;
		expect(matcher).toContain("startup");
		expect(matcher).toContain("resume");
		expect(matcher).toContain("clear");
		expect(matcher).toContain("compact");
	});

	it("should merge into existing settings without overwriting", async () => {
		// Pre-create settings with Stop hook
		await fs.mkdir(path.join(TEST_DIR, ".claude"), { recursive: true });
		await fs.writeFile(
			path.join(TEST_DIR, ".claude", "settings.local.json"),
			JSON.stringify({
				hooks: {
					Stop: [
						{
							hooks: [
								{
									type: "command",
									command: "agent-gauntlet stop-hook",
									timeout: 300,
								},
							],
						},
					],
				},
			}),
		);

		await installStartHook(TEST_DIR);

		const settingsPath = path.join(
			TEST_DIR,
			".claude",
			"settings.local.json",
		);
		const content = await fs.readFile(settingsPath, "utf-8");
		const settings = JSON.parse(content);

		// Both Stop and SessionStart should exist
		expect(settings.hooks.Stop).toBeDefined();
		expect(settings.hooks.SessionStart).toBeDefined();
	});

	it("should deduplicate on repeated runs", async () => {
		await installStartHook(TEST_DIR);
		await installStartHook(TEST_DIR);
		const settings = await readHookConfig(TEST_DIR, "claude");
		const hooks = settings.hooks as Record<string, unknown[]>;
		expect(hooks.SessionStart.length).toBe(1);
	});

	it("should show confirmation message", async () => {
		await installStartHook(TEST_DIR);

		const output = logs.join("\n");
		expect(output).toContain("Start hook installed");
	});
});

describe("Cursor Start Hook Installation", () => {
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

	it("should create sessionStart hook in new hooks file", async () => {
		await installCursorStartHook(TEST_DIR);

		const hooksPath = path.join(TEST_DIR, ".cursor", "hooks.json");
		const content = await fs.readFile(hooksPath, "utf-8");
		const config = JSON.parse(content);

		expect(Array.isArray(config.hooks.sessionStart)).toBe(true);
		expect(config.hooks.sessionStart.length).toBe(1);
		expect(config.hooks.sessionStart[0].command).toBe(
			"agent-gauntlet start-hook --adapter cursor",
		);
	});

	it("should deduplicate on repeated runs", async () => {
		await installCursorStartHook(TEST_DIR);
		await installCursorStartHook(TEST_DIR);
		const config = await readHookConfig(TEST_DIR, "cursor");
		const hooks = config.hooks as Record<string, unknown[]>;
		expect(hooks.sessionStart.length).toBe(1);
	});

	it("should merge into existing hooks file without overwriting", async () => {
		// Pre-create with stop hook
		await fs.mkdir(path.join(TEST_DIR, ".cursor"), { recursive: true });
		await fs.writeFile(
			path.join(TEST_DIR, ".cursor", "hooks.json"),
			JSON.stringify({
				version: 1,
				hooks: {
					stop: [
						{
							command: "agent-gauntlet stop-hook",
							loop_limit: 10,
						},
					],
				},
			}),
		);

		await installCursorStartHook(TEST_DIR);

		const hooksPath = path.join(TEST_DIR, ".cursor", "hooks.json");
		const content = await fs.readFile(hooksPath, "utf-8");
		const config = JSON.parse(content);

		// Both stop and sessionStart should exist
		expect(config.hooks.stop).toBeDefined();
		expect(config.hooks.stop[0].command).toBe("agent-gauntlet stop-hook");
		expect(config.hooks.sessionStart).toBeDefined();
		expect(config.hooks.sessionStart[0].command).toBe(
			"agent-gauntlet start-hook --adapter cursor",
		);
	});

	it("should show confirmation message", async () => {
		await installCursorStartHook(TEST_DIR);

		const output = logs.join("\n");
		expect(output).toContain("Cursor start hook installed");
	});
});

describe("mergeHookConfig helper", () => {
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
			path.join(TEST_DIR, ".merge-test"),
		]),
	);

	it("should create new file with hook config when file doesn't exist", async () => {
		const dir = path.join(TEST_DIR, ".merge-test");
		const filePath = path.join(dir, "settings.json");

		const added = await mergeHookConfig({
			filePath,
			hookKey: "Stop",
			hookEntry: { type: "command", command: "my-cmd", timeout: 60 },
			deduplicateCmd: "my-cmd",
			wrapInHooksArray: true,
		});

		expect(added).toBe(true);
		const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
		expect(content.hooks.Stop).toBeDefined();
		expect(Array.isArray(content.hooks.Stop)).toBe(true);
		expect(content.hooks.Stop[0].hooks[0].command).toBe("my-cmd");
	});

	it("should merge into existing file without overwriting other keys", async () => {
		const dir = path.join(TEST_DIR, ".merge-test");
		await fs.mkdir(dir, { recursive: true });
		const filePath = path.join(dir, "settings.json");

		// Write existing config with other keys
		await fs.writeFile(
			filePath,
			JSON.stringify({
				someKey: "preserved",
				hooks: { PreToolUse: [{ command: "echo hi" }] },
			}),
		);

		const added = await mergeHookConfig({
			filePath,
			hookKey: "Stop",
			hookEntry: { type: "command", command: "my-cmd", timeout: 60 },
			deduplicateCmd: "my-cmd",
			wrapInHooksArray: true,
		});

		expect(added).toBe(true);
		const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
		expect(content.someKey).toBe("preserved");
		expect(content.hooks.PreToolUse).toBeDefined();
		expect(content.hooks.Stop).toBeDefined();
	});

	it("should deduplicate on repeated calls", async () => {
		const dir = path.join(TEST_DIR, ".merge-test");
		const filePath = path.join(dir, "settings.json");

		// First call
		await mergeHookConfig({
			filePath,
			hookKey: "Stop",
			hookEntry: { type: "command", command: "my-cmd", timeout: 60 },
			deduplicateCmd: "my-cmd",
			wrapInHooksArray: true,
		});

		// Second call — should detect duplicate
		const added = await mergeHookConfig({
			filePath,
			hookKey: "Stop",
			hookEntry: { type: "command", command: "my-cmd", timeout: 60 },
			deduplicateCmd: "my-cmd",
			wrapInHooksArray: true,
		});

		expect(added).toBe(false);
		const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
		expect(content.hooks.Stop.length).toBe(1);
	});

	it("should work with flat hook entries (Cursor format, no wrapInHooksArray)", async () => {
		const dir = path.join(TEST_DIR, ".merge-test");
		const filePath = path.join(dir, "hooks.json");

		const added = await mergeHookConfig({
			filePath,
			hookKey: "stop",
			hookEntry: { command: "my-cmd", loop_limit: 10 },
			deduplicateCmd: "my-cmd",
			wrapInHooksArray: false,
		});

		expect(added).toBe(true);
		const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
		expect(content.hooks.stop).toBeDefined();
		expect(Array.isArray(content.hooks.stop)).toBe(true);
		// Flat format: entry is directly in the array, not wrapped
		expect(content.hooks.stop[0].command).toBe("my-cmd");
		expect(content.hooks.stop[0].hooks).toBeUndefined();
	});

	it("should preserve existing version in Cursor format", async () => {
		const dir = path.join(TEST_DIR, ".merge-test");
		await fs.mkdir(dir, { recursive: true });
		const filePath = path.join(dir, "hooks.json");

		// Write existing config with version already set
		await fs.writeFile(
			filePath,
			JSON.stringify({
				version: 2,
				hooks: {},
			}),
		);

		const added = await mergeHookConfig({
			filePath,
			hookKey: "stop",
			hookEntry: { command: "my-cmd", loop_limit: 10 },
			deduplicateCmd: "my-cmd",
			wrapInHooksArray: false,
			baseConfig: { version: 1 },
		});

		expect(added).toBe(true);
		const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
		// Should preserve existing version (2), not overwrite with baseConfig (1)
		expect(content.version).toBe(2);
		expect(content.hooks.stop[0].command).toBe("my-cmd");
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

	it("should install skills to .claude/skills", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Claude skills should be created
		const claudeSkillsDir = path.join(TEST_DIR, ".claude", "skills");
		const stat = await fs.stat(claudeSkillsDir);
		expect(stat.isDirectory()).toBe(true);
	});
});

describe("Skills Installation for Claude", () => {
	const originalConsoleLog = console.log;
	const originalCwd = process.cwd();
	let logs: string[];
	let program: Command;

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

	it("should install Claude skills as SKILL.md files under .claude/skills/gauntlet-*/", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const skillsDir = path.join(TEST_DIR, ".claude", "skills");
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
			".claude",
			"skills",
			"gauntlet-check",
			"SKILL.md",
		);
		const content = await fs.readFile(checkPath, "utf-8");

		expect(content).toContain("agent-gauntlet check");
	});

	it("should set correct frontmatter for all skills", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const skillsBase = path.join(TEST_DIR, ".claude", "skills");

		for (const action of ["check", "push-pr", "fix-pr", "status"]) {
			const content = await fs.readFile(
				path.join(skillsBase, `gauntlet-${action}`, "SKILL.md"),
				"utf-8",
			);
			expect(content).toContain(`name: gauntlet-${action}`);
			expect(content).toContain("disable-model-invocation: true");
		}

		// "run" should have disable-model-invocation: false (auto-invocation enabled)
		const runContent = await fs.readFile(
			path.join(skillsBase, "gauntlet-run", "SKILL.md"),
			"utf-8",
		);
		expect(runContent).toContain("name: gauntlet-run");
		expect(runContent).toContain("disable-model-invocation: false");
	});

	it("should include actionable description in gauntlet-run frontmatter", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const skillsBase = path.join(TEST_DIR, ".claude", "skills");
		const runContent = await fs.readFile(
			path.join(skillsBase, "gauntlet-run", "SKILL.md"),
			"utf-8",
		);
		expect(runContent).toContain("final step after completing a coding task");
		expect(runContent).toContain("before committing, pushing, or creating PRs");
	});

	it("should install gauntlet-help SKILL.md for Claude", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const helpSkillPath = path.join(
			TEST_DIR,
			".claude",
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
			".claude",
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

	it("should install gauntlet-setup SKILL.md for Claude", async () => {
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const setupSkillPath = path.join(
			TEST_DIR,
			".claude",
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
			".claude",
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

	it("should handle existing skill files with matching checksums", async () => {
		// First run installs all skills
		await program.parseAsync(["node", "test", "init", "--yes"]);

		// Second run should skip skills with matching checksums
		logs = [];
		await fs.rm(path.join(TEST_DIR, ".gauntlet"), {
			recursive: true,
			force: true,
		});
		await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });

		program = new Command();
		registerInitCommand(program);
		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		// Should not see "Created" or "Updated" for any skill
		expect(output).not.toContain("Created .claude/skills/gauntlet-run/SKILL.md");
		expect(output).not.toContain("Updated .claude/skills/gauntlet-run/SKILL.md");
	});
});
