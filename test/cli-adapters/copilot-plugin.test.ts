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
import { PassThrough } from "node:stream";

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
		let spawnSpy: ReturnType<typeof spyOn>;

		function mockSpawnSuccess(stdout = "review output", stderr = "") {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock child process typing
				((..._args: any[]) => {
					const child = {
						stdin: new PassThrough(),
						stdout: new PassThrough(),
						stderr: new PassThrough(),
						kill: mock(() => true),
						// biome-ignore lint/suspicious/noExplicitAny: minimal EventEmitter-compatible surface
						on(event: string, callback: (...args: any[]) => void) {
							if (event === "close") {
								queueMicrotask(() => {
									if (stdout) child.stdout.write(stdout);
									if (stderr) child.stderr.write(stderr);
									child.stdout.end();
									child.stderr.end();
									callback(0, null);
								});
							}
							return child;
						},
					};
					return child;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);
		}

		beforeEach(async () => {
			const { GitHubCopilotAdapter } = await import(
				"../../src/cli-adapters/github-copilot.js"
			);
			adapter = new GitHubCopilotAdapter();
			mockSpawnSuccess();
		});

		afterEach(() => {
			execSpy?.mockRestore();
			spawnSpy?.mockRestore();
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
						callback(new Error("copilot: command not found"), "", "");
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
						callback(new Error("copilot: command not found"), "", "");
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

		it("returns unhealthy with the CLI error when copilot exists but cannot start", async () => {
			execSpy = spyOn(childProcess, "exec").mockImplementation(
				// biome-ignore lint/suspicious/noExplicitAny: mock typing
				((...args: any[]) => {
					const callback = args[args.length - 1];
					if (typeof callback === "function") {
						callback(
							new Error("Command failed"),
							"",
							"ERROR: SecItemCopyMatching failed -50\n",
						);
					}
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
					return {} as any;
					// biome-ignore lint/suspicious/noExplicitAny: mock typing
				}) as any,
			);
			const result = await adapter.checkHealth();
			expect(result).toEqual({
				available: true,
				status: "unhealthy",
				message: "ERROR: SecItemCopyMatching failed -50",
			});
		});
	});

	describe("execute", () => {
		it("uses copilot command (not gh copilot)", async () => {
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

				expect(spawnSpy.mock.calls[0][0]).toBe("copilot");
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

				const args = spawnSpy.mock.calls[0][1] as string[];
				expect(args).toContain("--allow-tool");
				expect(args).toContain("shell(cat)");
			});

		it("keeps only the prompt-file reader tool when allowToolUse is false", async () => {
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

				const args = spawnSpy.mock.calls[0][1] as string[];
				expect(args).toContain("--allow-tool");
				expect(args).toContain("shell(cat)");
				expect(args).not.toContain("shell(grep)");
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

				const args = spawnSpy.mock.calls[0][1] as string[];
				expect(args).toContain("--effort");
				expect(args).toContain("medium");
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

				const args = spawnSpy.mock.calls[0][1] as string[];
				expect(args).not.toContain("--effort");
			});

		it("parses session telemetry from stdout and verifies requested model", async () => {
			spawnSpy.mockRestore();
			mockSpawnSuccess(
				[
					"review output",
					"Total usage est:        1 Premium request",
					"Breakdown by AI model:",
					" gpt-5.3-codex           17.7k in, 45 out, 1.5k cached (Est. 1 Premium request)",
				].join("\n"),
				"",
			);
			const chunks: string[] = [];

			const result = await adapter.execute({
				prompt: "Review this",
				diff: "some diff",
				model: "gpt-5.3-codex",
				onOutput: (chunk: string) => chunks.push(chunk),
			});

			expect(result).toContain("review output");
			expect(chunks.some((chunk) => chunk.includes("[copilot-telemetry]"))).toBe(
				true,
			);
		});

		it("keeps prompt+diff out of argv while using --prompt non-interactive mode", async () => {
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

				expect(spawnSpy.mock.calls[0][0]).toBe("copilot");
				const args = spawnSpy.mock.calls[0][1] as string[];
				const promptIndex = args.indexOf("--prompt");
				expect(promptIndex).toBeGreaterThanOrEqual(0);
				expect(args[promptIndex + 1]).toContain("validator-copilot-");
				const addDirIndex = args.indexOf("--add-dir");
				expect(addDirIndex).toBeGreaterThanOrEqual(0);
				expect(args[addDirIndex + 1]).toContain("validator-copilot-");
				expect(args.join(" ")).not.toContain("Review this code");
				expect(args.join(" ")).not.toContain("--- DIFF ---");
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

					const lastCall = spawnSpy.mock.calls[spawnSpy.mock.calls.length - 1];
					const args = lastCall![1] as string[];
					expect(args).toContain("--effort");
					expect(args).toContain(level);
				}
			});
	});
});
