import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Mock copilot-cli module before importing the adapter
const mockInstallPlugin = mock(() =>
	Promise.resolve({ success: true } as { success: boolean; stderr?: string }),
);
const mockDetectPlugin = mock(
	() => Promise.resolve(null) as Promise<"user" | null>,
);

mock.module("../../src/plugin/copilot-cli.js", () => ({
	installPlugin: mockInstallPlugin,
	detectPlugin: mockDetectPlugin,
}));

describe("GitHubCopilotAdapter plugin lifecycle", () => {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
	let adapter: any;

	beforeEach(async () => {
		const { GitHubCopilotAdapter } = await import(
			"../../src/cli-adapters/github-copilot.js"
		);
		adapter = new GitHubCopilotAdapter();
		mockInstallPlugin.mockReset();
		mockDetectPlugin.mockReset();
		mockInstallPlugin.mockImplementation(() =>
			Promise.resolve({ success: true }),
		);
		mockDetectPlugin.mockImplementation(() => Promise.resolve(null));
	});

	describe("detectPlugin", () => {
		it("returns null when plugin is not installed", async () => {
			mockDetectPlugin.mockImplementation(() => Promise.resolve(null));
			const result = await adapter.detectPlugin("/some/project");
			expect(result).toBeNull();
		});

		it("returns 'user' when plugin is detected", async () => {
			mockDetectPlugin.mockImplementation(() => Promise.resolve("user" as const));
			const result = await adapter.detectPlugin("/some/project");
			expect(result).toBe("user");
		});
	});

	describe("installPlugin", () => {
		it("returns success when install succeeds", async () => {
			const result = await adapter.installPlugin("user");
			expect(result).toEqual({ success: true });
			expect(mockInstallPlugin).toHaveBeenCalledTimes(1);
		});

		it("accepts scope parameter for interface compatibility but delegates to copilot-cli", async () => {
			await adapter.installPlugin("project");
			// Copilot always installs to user scope, but the adapter accepts scope for compatibility
			expect(mockInstallPlugin).toHaveBeenCalledTimes(1);
		});

		it("returns failure with error when install fails", async () => {
			mockInstallPlugin.mockImplementation(() =>
				Promise.resolve({
					success: false,
					stderr: "install error",
				}),
			);
			const result = await adapter.installPlugin("user");
			expect(result).toEqual({
				success: false,
				error: "install error",
			});
		});
	});

	describe("updatePlugin", () => {
		it("delegates to installPlugin (re-install overwrites)", async () => {
			const result = await adapter.updatePlugin!("user");
			expect(result).toEqual({ success: true });
			expect(mockInstallPlugin).toHaveBeenCalledTimes(1);
		});
	});

	describe("getManualInstallInstructions", () => {
		it("returns instructions including copilot plugin install command", () => {
			const instructions = adapter.getManualInstallInstructions("user");
			expect(instructions.length).toBeGreaterThan(0);
			expect(
				instructions.some((i: string) =>
					i.includes("copilot plugin install Codagent-AI/agent-validator"),
				),
			).toBe(true);
		});
	});

	describe("getProjectSkillDir", () => {
		it("returns .github/skills", () => {
			expect(adapter.getProjectSkillDir()).toBe(".github/skills");
		});
	});

	describe("getUserSkillDir", () => {
		it("returns absolute path ending in .copilot/skills", () => {
			const result = adapter.getUserSkillDir();
			expect(result).not.toBeNull();
			expect(result!.endsWith(path.join(".copilot", "skills"))).toBe(true);
		});
	});

	describe("supportsHooks", () => {
		it("returns true", () => {
			expect(adapter.supportsHooks()).toBe(true);
		});
	});
});

describe("GitHubCopilotAdapter execution", () => {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
	let adapter: any;
	let execSpy: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		const { GitHubCopilotAdapter } = await import(
			"../../src/cli-adapters/github-copilot.js"
		);
		adapter = new GitHubCopilotAdapter();
	});

	afterEach(() => {
		execSpy?.mockRestore();
	});

	describe("isAvailable", () => {
		it("runs copilot --help to check availability", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(null, "usage: copilot", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);
			const result = await adapter.isAvailable();
			expect(result).toBe(true);
			// Verify it called copilot --help
			const callArgs = execSpy.mock.calls[0];
			expect(callArgs[0]).toBe("copilot --help");
		});

		it("returns false when copilot is not available", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(new Error("Command failed"), "", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);
			const result = await adapter.isAvailable();
			expect(result).toBe(false);
		});
	});

	describe("checkHealth", () => {
		it("returns missing when copilot is not available", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(new Error("Command failed"), "", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);
			const result = await adapter.checkHealth();
			expect(result).toEqual({
				available: false,
				status: "missing",
				message: "Command not found",
			});
		});
	});

	describe("execute", () => {
		it("resolves model via --list-models before passing to command", async () => {
			let callIndex = 0;
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						if (callIndex === 0) {
							// First call: --list-models for model resolution
							callback(
								null,
								"gpt-5.3-codex - GPT 5.3 Codex\ngpt-5.2-codex - GPT 5.2 Codex\n",
								"",
							);
						} else {
							// Second call: actual review command
							callback(null, "review output", "");
						}
						callIndex++;
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);

			await adapter.execute({
				prompt: "Review this",
				diff: "some diff",
				model: "codex",
			});

			// First call should be --list-models
			const listCmd = execSpy.mock.calls[0][0] as string;
			expect(listCmd).toContain("--list-models");
			// Second call should use the resolved model
			const reviewCmd = execSpy.mock.calls[1][0] as string;
			expect(reviewCmd).toContain("--model gpt-5.3-codex");
		});

		it("uses copilot command with -s flag", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(null, "review output", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);

			await adapter.execute({
				prompt: "Review this",
				diff: "some diff",
			});

			const cmd = execSpy.mock.calls[0][0] as string;
			expect(cmd).toContain("copilot");
			expect(cmd).not.toContain("gh copilot");
			expect(cmd).toContain("-s");
		});

		it("includes --allow-tool flags when allowToolUse is not false", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(null, "review output", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);

			await adapter.execute({
				prompt: "Review this",
				diff: "some diff",
				allowToolUse: true,
			});

			const cmd = execSpy.mock.calls[0][0] as string;
			expect(cmd).toContain("--allow-tool");
			expect(cmd).toContain("shell(cat)");
		});

		it("omits --allow-tool flags when allowToolUse is false", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(null, "review output", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);

			await adapter.execute({
				prompt: "Review this",
				diff: "some diff",
				allowToolUse: false,
			});

			const cmd = execSpy.mock.calls[0][0] as string;
			expect(cmd).not.toContain("--allow-tool");
		});

		it("maps thinkingBudget to --effort flag", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(null, "review output", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);

			await adapter.execute({
				prompt: "Review this",
				diff: "some diff",
				thinkingBudget: "medium",
			});

			const cmd = execSpy.mock.calls[0][0] as string;
			expect(cmd).toContain("--effort medium");
		});

		it("omits --effort flag when thinkingBudget is off", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(null, "review output", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);

			await adapter.execute({
				prompt: "Review this",
				diff: "some diff",
				thinkingBudget: "off",
			});

			const cmd = execSpy.mock.calls[0][0] as string;
			expect(cmd).not.toContain("--effort");
		});

		it("pipes prompt+diff via stdin using cat tmpFile pattern", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(null, "review output", "");
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);

			await adapter.execute({
				prompt: "Review this code",
				diff: "--- a/file.ts\n+++ b/file.ts",
			});

			const cmd = execSpy.mock.calls[0][0] as string;
			// Verify the command uses cat to pipe temp file content to copilot via stdin
			expect(cmd).toMatch(/^cat ".*validator-copilot-.*\.txt" \| copilot /);
		});

		it("maps all thinkingBudget levels correctly", async () => {
			const levels = ["low", "medium", "high"];

			for (const level of levels) {
				execSpy?.mockRestore();
				execSpy = spyOn(childProcess, "exec").mockImplementation(
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					((...args: any[]) => {
						const callback = args[args.length - 1];
						if (typeof callback === "function") {
							callback(null, "review output", "");
						}
						// biome-ignore lint/suspicious/noExplicitAny: mock typing
						return {} as any;
						// biome-ignore lint/suspicious/noExplicitAny: mock typing
					}) as any,
				);

				await adapter.execute({
					prompt: "Review this",
					diff: "some diff",
					thinkingBudget: level,
				});

				const cmd = execSpy.mock.calls[0][0] as string;
				expect(cmd).toContain(`--effort ${level}`);
			}
		});
	});
});
