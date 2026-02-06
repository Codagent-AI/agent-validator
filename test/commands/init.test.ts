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

// Mock adapters
const mockAdapters = [
	{
		name: "mock-cli-1",
		isAvailable: async () => true,
		getProjectCommandDir: () => ".mock1",
		getUserCommandDir: () => null,
		getCommandExtension: () => ".sh",
		canUseSymlink: () => false,
		transformCommand: (content: string) => content,
	},
	{
		name: "mock-cli-2",
		isAvailable: async () => false, // Not available
		getProjectCommandDir: () => ".mock2",
		getUserCommandDir: () => null,
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
const { registerInitCommand, installStopHook } = await import(
	"../../src/commands/init.js"
);

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

	afterEach(() => {
		console.log = originalConsoleLog;
		process.chdir(originalCwd);
		// Cleanup any created .gauntlet directory
		return fs
			.rm(path.join(TEST_DIR, ".gauntlet"), { recursive: true, force: true })
			.catch(() => {});
	});

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
		const runGauntletFile = path.join(gauntletDir, "run_gauntlet.md");

		expect(await fs.stat(gauntletDir)).toBeDefined();
		expect(await fs.stat(configFile)).toBeDefined();
		expect(await fs.stat(reviewsDir)).toBeDefined();
		expect(await fs.stat(checksDir)).toBeDefined();
		expect(await fs.stat(runGauntletFile)).toBeDefined();

		// Verify config content
		const configContent = await fs.readFile(configFile, "utf-8");
		expect(configContent).toContain("base_branch");
		expect(configContent).toContain("log_dir");
		expect(configContent).toContain("mock-cli-1"); // Should be present
		expect(configContent).not.toContain("mock-cli-2"); // Should not be present (unavailable)

		// Verify config references code-quality review (file-based, not built-in: prefix)
		expect(configContent).toContain("code-quality");
		expect(configContent).not.toContain("built-in:code-quality");

		// Verify YAML review file was created
		const reviewFiles = await fs.readdir(reviewsDir);
		expect(reviewFiles).toContain("code-quality.yml");
		const reviewContent = await fs.readFile(
			path.join(reviewsDir, "code-quality.yml"),
			"utf-8",
		);
		expect(reviewContent).toContain("builtin: code-quality");
		expect(reviewContent).toContain("num_reviews: 2");
	});

	it("should not create directory if .gauntlet already exists", async () => {
		// Create .gauntlet directory first
		const gauntletDir = path.join(TEST_DIR, ".gauntlet");
		await fs.mkdir(gauntletDir, { recursive: true });

		await program.parseAsync(["node", "test", "init", "--yes"]);

		const output = logs.join("\n");
		expect(output).toContain(".gauntlet directory already exists");
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

	afterEach(async () => {
		console.log = originalConsoleLog;
		process.chdir(originalCwd);
		// Cleanup
		await fs
			.rm(path.join(TEST_DIR, ".claude"), { recursive: true, force: true })
			.catch(() => {});
	});

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
