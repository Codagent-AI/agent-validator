import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { CursorAdapter } from "../../src/cli-adapters/cursor.js";

type PluginListEntry = {
	name?: string;
	scope?: string;
	projectPath?: string;
};
const listPluginsMock = mock(async () => [] as PluginListEntry[]);
const updateMarketplaceMock = mock(async (_name: string) => ({ success: true }));
const updatePluginMock = mock(async (_name: string) => ({ success: true }));

const addMarketplaceMock = mock(async () => ({ success: true }));
const installPluginMock = mock(async (_scope: string) => ({ success: true }));

// Cursor adapter spies — spy on prototype methods instead of using mock.module so
// the cursor.js module registration is not replaced (which would leak into other test
// files that test CursorAdapter directly, per oven-sh/bun#6024).
// biome-ignore lint/suspicious/noExplicitAny: spy mock typing
let cursorDetectPluginSpy: ReturnType<typeof spyOn<any, any>>;
// biome-ignore lint/suspicious/noExplicitAny: spy mock typing
let cursorUpdatePluginSpy: ReturnType<typeof spyOn<any, any>>;

mock.module("../../src/plugin/claude-cli.js", () => ({
	addMarketplace: () => addMarketplaceMock(),
	installPlugin: (scope: string) => installPluginMock(scope),
	listPlugins: () => listPluginsMock(),
	updateMarketplace: (name: string) => updateMarketplaceMock(name),
	updatePlugin: (name: string) => updatePluginMock(name),
}));

const { registerUpdateCommand } = await import("../../src/commands/update.js");
const { runPluginUpdate } = await import("../../src/commands/plugin-update.js");

describe("update command", () => {
	let testDir: string;
	let homeDir: string;
	let originalCwd: string;
	let originalHome: string | undefined;
	let logs: string[];
	let errors: string[];
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-update-test-"));
		homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-update-home-"));
		originalCwd = process.cwd();
		originalHome = process.env.HOME;
		process.chdir(testDir);
		process.env.HOME = homeDir;
		logs = [];
		errors = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		console.error = (...args: unknown[]) => {
			errors.push(args.join(" "));
		};
		listPluginsMock.mockClear();
		updateMarketplaceMock.mockClear();
		updatePluginMock.mockClear();
		addMarketplaceMock.mockClear();
		installPluginMock.mockClear();

		// Set up prototype spies with default implementations
		cursorDetectPluginSpy = spyOn(
			CursorAdapter.prototype,
			"detectPlugin",
		).mockResolvedValue(null);
		cursorUpdatePluginSpy = spyOn(
			CursorAdapter.prototype,
			"updatePlugin",
		).mockResolvedValue({ success: true });
	});

	afterEach(async () => {
		console.log = originalConsoleLog;
		console.error = originalConsoleError;
		process.chdir(originalCwd);
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		await fs.rm(testDir, { recursive: true, force: true });
		await fs.rm(homeDir, { recursive: true, force: true });
		cursorDetectPluginSpy.mockRestore();
		cursorUpdatePluginSpy.mockRestore();
	});

	it("registers the update command", () => {
		const program = new Command();
		registerUpdateCommand(program);
		const cmd = program.commands.find((c) => c.name() === "update");
		expect(cmd).toBeDefined();
	});

	it("fails when plugin is not installed anywhere", async () => {
		listPluginsMock.mockImplementationOnce(async () => []);

		await expect(runPluginUpdate()).rejects.toThrow(
			"run `agent-validate init` first",
		);
	});

	it("updates project scope when installed for current project", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "project", projectPath: testDir },
		]);
		await fs.mkdir(path.join(testDir, ".agents", "skills", "validator-run"), {
			recursive: true,
		});
		await fs.mkdir(path.join(testDir, ".agents", "skills", "validator-help"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(testDir, ".agents", "skills", "validator-help", "SKILL.md"),
			"outdated",
		);

		const program = new Command();
		registerUpdateCommand(program);
		await program.parseAsync(["node", "test", "update"]);

		expect(updateMarketplaceMock).toHaveBeenCalledTimes(1);
		expect(updatePluginMock).toHaveBeenCalledTimes(1);
		expect(logs.join("\n")).toContain("project scope");
		const updated = await fs.readFile(
			path.join(testDir, ".agents", "skills", "validator-help", "SKILL.md"),
			"utf-8",
		);
		const source = await fs.readFile(
			path.join(originalCwd, "skills", "validator-help", "SKILL.md"),
			"utf-8",
		);
		expect(updated).toBe(source);
	});

	it("updates global Codex skills when only global marker exists", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		await fs.mkdir(path.join(homeDir, ".agents", "skills", "validator-run"), {
			recursive: true,
		});
		await fs.mkdir(
			path.join(homeDir, ".agents", "skills", "validator-status"),
			{
				recursive: true,
			},
		);
		await fs.writeFile(
			path.join(homeDir, ".agents", "skills", "validator-status", "SKILL.md"),
			"outdated",
		);

		await runPluginUpdate();

		const updated = await fs.readFile(
			path.join(homeDir, ".agents", "skills", "validator-status", "SKILL.md"),
			"utf-8",
		);
		const source = await fs.readFile(
			path.join(originalCwd, "skills", "validator-status", "SKILL.md"),
			"utf-8",
		);
		expect(updated).toBe(source);
	});

	it("prefers local Codex skills when both local and global markers exist", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "project", projectPath: testDir },
			{ name: "agent-validator", scope: "user" },
		]);
		await fs.mkdir(path.join(testDir, ".agents", "skills", "validator-run"), {
			recursive: true,
		});
		await fs.mkdir(path.join(testDir, ".agents", "skills", "validator-check"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(testDir, ".agents", "skills", "validator-check", "SKILL.md"),
			"local old",
		);
		await fs.mkdir(path.join(homeDir, ".agents", "skills", "validator-run"), {
			recursive: true,
		});
		await fs.mkdir(path.join(homeDir, ".agents", "skills", "validator-check"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(homeDir, ".agents", "skills", "validator-check", "SKILL.md"),
			"global old",
		);

		await runPluginUpdate();

		const localUpdated = await fs.readFile(
			path.join(testDir, ".agents", "skills", "validator-check", "SKILL.md"),
			"utf-8",
		);
		const globalUpdated = await fs.readFile(
			path.join(homeDir, ".agents", "skills", "validator-check", "SKILL.md"),
			"utf-8",
		);
		const source = await fs.readFile(
			path.join(originalCwd, "skills", "validator-check", "SKILL.md"),
			"utf-8",
		);
		expect(localUpdated).toBe(source);
		expect(globalUpdated).toBe("global old");
	});

	it("prints manual update instructions when update fails", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		updateMarketplaceMock.mockImplementation(async () => ({
			success: false,
			stderr: "marketplace unavailable",
		}));
		addMarketplaceMock.mockImplementationOnce(async () => ({
			success: false,
			stderr: "add failed",
		}));

		await expect(runPluginUpdate()).rejects.toThrow("marketplace unavailable");
		expect(updatePluginMock).not.toHaveBeenCalled();
		const output = errors.join("\n");
		expect(output).toContain("Plugin update failed");
		expect(output).toContain("claude plugin marketplace update agent-validator");
		expect(output).toContain(
			"claude plugin update agent-validator@Codagent-AI/agent-validator",
		);

		// Restore default so other tests aren't affected
		updateMarketplaceMock.mockImplementation(async () => ({ success: true }));
	});

	it("re-adds marketplace and retries when marketplace update fails", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		// First call fails, second (after re-add) succeeds
		updateMarketplaceMock
			.mockImplementationOnce(async () => ({
				success: false,
				stderr: "Marketplace 'agent-validator' not found",
			}))
			.mockImplementationOnce(async () => ({ success: true }));

		await runPluginUpdate();

		expect(addMarketplaceMock).toHaveBeenCalledTimes(1);
		expect(updateMarketplaceMock).toHaveBeenCalledTimes(2);
		expect(updatePluginMock).toHaveBeenCalledTimes(1);
		const output = logs.join("\n");
		expect(output).toContain("re-adding");
	});

	it("reinstalls plugin when plugin update fails", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		updatePluginMock.mockImplementationOnce(async () => ({
			success: false,
			stderr: 'Plugin "agent-validator" not found',
		}));

		await runPluginUpdate();

		expect(installPluginMock).toHaveBeenCalledWith("user");
		const output = logs.join("\n");
		expect(output).toContain("reinstalling");
	});

	it("fails when no Claude plugin and no Cursor plugin are installed", async () => {
		listPluginsMock.mockImplementationOnce(async () => []);
		// cursorDetectPluginSpy already returns null by default

		await expect(runPluginUpdate()).rejects.toThrow(
			"run `agent-validate init` first",
		);
		expect(updateMarketplaceMock).not.toHaveBeenCalled();
		expect(cursorUpdatePluginSpy).not.toHaveBeenCalled();
	});

	it("skips Claude update and updates Cursor when only Cursor is installed", async () => {
		listPluginsMock.mockImplementationOnce(async () => []);
		cursorDetectPluginSpy.mockResolvedValueOnce("user");

		await runPluginUpdate();

		expect(updateMarketplaceMock).not.toHaveBeenCalled();
		expect(updatePluginMock).not.toHaveBeenCalled();
		expect(cursorUpdatePluginSpy).toHaveBeenCalledTimes(1);
		const [calledScope, calledPath] = cursorUpdatePluginSpy.mock.calls[0] as [
			string,
			string,
		];
		expect(calledScope).toBe("user");
		// cwd and testDir may differ due to symlink resolution on macOS
		expect(calledPath).toBeTruthy();
		const output = logs.join("\n");
		expect(output).toMatch(/[Cc]ursor/);
	});

	it("updates both Claude and Cursor when both are installed", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		cursorDetectPluginSpy.mockResolvedValueOnce("project");

		await runPluginUpdate();

		expect(updateMarketplaceMock).toHaveBeenCalledTimes(1);
		expect(updatePluginMock).toHaveBeenCalledTimes(1);
		expect(cursorUpdatePluginSpy).toHaveBeenCalledTimes(1);
		const [calledScope] = cursorUpdatePluginSpy.mock.calls[0] as [string];
		expect(calledScope).toBe("project");
	});

	it("warns and continues when Cursor update fails", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		cursorDetectPluginSpy.mockResolvedValueOnce("user");
		cursorUpdatePluginSpy.mockResolvedValueOnce({
			success: false,
			error: "copy failed",
		});

		// Should NOT throw
		await expect(runPluginUpdate()).resolves.toBeUndefined();

		const output = errors.join("\n");
		expect(output).toContain("copy failed");
	});

	it("reports success message after Cursor update", async () => {
		listPluginsMock.mockImplementationOnce(async () => []);
		cursorDetectPluginSpy.mockResolvedValueOnce("user");

		await runPluginUpdate();

		const output = logs.join("\n");
		expect(output).toMatch(/[Cc]ursor/);
		expect(output).toMatch(/updat/i);
	});

	it("tells user to restart Cursor sessions after update", async () => {
		listPluginsMock.mockImplementationOnce(async () => []);
		cursorDetectPluginSpy.mockResolvedValueOnce("user");

		await runPluginUpdate();

		const output = logs.join("\n");
		expect(output).toMatch(/restart/i);
	});

	it("skips Cursor update silently when Cursor plugin not installed", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		// cursorDetectPluginSpy already returns null by default

		await runPluginUpdate();

		expect(cursorUpdatePluginSpy).not.toHaveBeenCalled();
	});

	it("throws when Claude marketplace update fails completely (Cursor update is not reached)", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		cursorDetectPluginSpy.mockResolvedValueOnce("user");
		updateMarketplaceMock.mockImplementation(async () => ({
			success: false,
			stderr: "marketplace down",
		}));
		addMarketplaceMock.mockImplementationOnce(async () => ({
			success: false,
			stderr: "add failed",
		}));

		await expect(runPluginUpdate()).rejects.toThrow("marketplace down");
		expect(cursorUpdatePluginSpy).not.toHaveBeenCalled();

		// Restore default
		updateMarketplaceMock.mockImplementation(async () => ({ success: true }));
	});

	it("throws when Claude plugin update and reinstall both fail", async () => {
		listPluginsMock.mockImplementationOnce(async () => [
			{ name: "agent-validator", scope: "user" },
		]);
		cursorDetectPluginSpy.mockResolvedValueOnce("user");
		updatePluginMock.mockImplementationOnce(async () => ({
			success: false,
			stderr: "plugin not found",
		}));
		installPluginMock.mockImplementationOnce(async () => ({
			success: false,
			stderr: "install failed",
		}));

		await expect(runPluginUpdate()).rejects.toThrow("install failed");
		expect(cursorUpdatePluginSpy).not.toHaveBeenCalled();
	});
});
