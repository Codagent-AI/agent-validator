import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Mock the claude-cli module before importing the adapter
const mockListPlugins = mock(() => Promise.resolve([] as unknown[]));
const mockAddMarketplace = mock(() =>
	Promise.resolve({ success: true } as { success: boolean; stderr?: string }),
);
const mockInstallPluginCli = mock((scope: "user" | "project") =>
	Promise.resolve({ success: true } as { success: boolean; stderr?: string }),
);

const mockUpdateMarketplace = mock(() =>
	Promise.resolve({ success: true } as { success: boolean; stderr?: string }),
);
const mockUpdatePlugin = mock(() =>
	Promise.resolve({ success: true } as { success: boolean; stderr?: string }),
);

mock.module("../../src/plugin/claude-cli.js", () => ({
	listPlugins: mockListPlugins,
	addMarketplace: mockAddMarketplace,
	installPlugin: mockInstallPluginCli,
	updateMarketplace: mockUpdateMarketplace,
	updatePlugin: mockUpdatePlugin,
}));

describe("ClaudeAdapter plugin lifecycle", () => {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
	let adapter: any;

	beforeEach(async () => {
		const { ClaudeAdapter } = await import(
			"../../src/cli-adapters/claude.js"
		);
		adapter = new ClaudeAdapter();
		mockListPlugins.mockReset();
		mockAddMarketplace.mockReset();
		mockInstallPluginCli.mockReset();
		// Restore default success implementations
		mockAddMarketplace.mockImplementation(() =>
			Promise.resolve({ success: true }),
		);
		mockInstallPluginCli.mockImplementation(() =>
			Promise.resolve({ success: true }),
		);
	});

	describe("detectPlugin", () => {
		it("returns null when no plugins are installed", async () => {
			mockListPlugins.mockImplementation(() => Promise.resolve([]));
			const result = await adapter.detectPlugin("/some/project");
			expect(result).toBeNull();
		});

		it("returns 'user' when user-scoped plugin is found", async () => {
			mockListPlugins.mockImplementation(() =>
				Promise.resolve([
					{ name: "agent-gauntlet", scope: "user" },
				]),
			);
			const result = await adapter.detectPlugin("/some/project");
			expect(result).toBe("user");
		});

		it("returns 'project' when project-scoped plugin is found", async () => {
			mockListPlugins.mockImplementation(() =>
				Promise.resolve([
					{
						name: "agent-gauntlet",
						scope: "project",
						projectPath: "/some/project",
					},
				]),
			);
			const result = await adapter.detectPlugin("/some/project");
			expect(result).toBe("project");
		});

		it("returns null when listPlugins throws", async () => {
			mockListPlugins.mockImplementation(() =>
				Promise.reject(new Error("CLI not found")),
			);
			const result = await adapter.detectPlugin("/some/project");
			expect(result).toBeNull();
		});

		it("matches plugin entries with id field", async () => {
			mockListPlugins.mockImplementation(() =>
				Promise.resolve([
					{ id: "agent-gauntlet", scope: "user" },
				]),
			);
			const result = await adapter.detectPlugin("/some/project");
			expect(result).toBe("user");
		});

		it("matches plugin entries with versioned name", async () => {
			mockListPlugins.mockImplementation(() =>
				Promise.resolve([
					{ name: "agent-gauntlet@1.0.0", scope: "user" },
				]),
			);
			const result = await adapter.detectPlugin("/some/project");
			expect(result).toBe("user");
		});
	});

	describe("installPlugin", () => {
		it("returns success when both marketplace add and install succeed", async () => {
			const result = await adapter.installPlugin("user");
			expect(result).toEqual({ success: true });
			expect(mockAddMarketplace).toHaveBeenCalledTimes(1);
			expect(mockInstallPluginCli).toHaveBeenCalledTimes(1);
			expect(mockInstallPluginCli).toHaveBeenCalledWith("user");
		});

		it("returns failure with error when marketplace add fails", async () => {
			mockAddMarketplace.mockImplementation(() =>
				Promise.resolve({
					success: false,
					stderr: "marketplace error",
				}),
			);
			const result = await adapter.installPlugin("user");
			expect(result).toEqual({
				success: false,
				error: "marketplace error",
			});
			expect(mockInstallPluginCli).not.toHaveBeenCalled();
		});

		it("returns failure with error when install fails", async () => {
			mockInstallPluginCli.mockImplementation(() =>
				Promise.resolve({
					success: false,
					stderr: "install error",
				}),
			);
			const result = await adapter.installPlugin("project");
			expect(result).toEqual({
				success: false,
				error: "install error",
			});
		});

		it("passes scope to installPluginCli", async () => {
			await adapter.installPlugin("project");
			expect(mockInstallPluginCli).toHaveBeenCalledWith("project");
		});
	});

	describe("getManualInstallInstructions", () => {
		it("returns correct CLI commands for user scope", () => {
			const instructions = adapter.getManualInstallInstructions("user");
			expect(instructions).toEqual([
				"claude plugin marketplace add pcaplan/agent-gauntlet",
				"claude plugin install agent-gauntlet --scope user",
			]);
		});

		it("returns correct CLI commands for project scope", () => {
			const instructions =
				adapter.getManualInstallInstructions("project");
			expect(instructions).toEqual([
				"claude plugin marketplace add pcaplan/agent-gauntlet",
				"claude plugin install agent-gauntlet --scope project",
			]);
		});
	});
});
