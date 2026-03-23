import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	spyOn,
} from "bun:test";
import * as childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("copilot-cli plugin module", () => {
	let tmpDir: string;
	const tmpDirs: string[] = [];

	async function makeTmpDir(): Promise<string> {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-cli-test-"));
		tmpDirs.push(dir);
		return dir;
	}

	afterEach(async () => {
		for (const dir of tmpDirs) {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
		tmpDirs.length = 0;
	});

	describe("installPlugin", () => {
		it("runs gh copilot -- plugin install Codagent-AI/agent-validator", async () => {
			const spy = spyOn(childProcess, "execFileSync").mockReturnValue("" as string & Buffer);

			const { installPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await installPlugin();

			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy.mock.calls[0][0]).toBe("gh");
			expect(spy.mock.calls[0][1]).toEqual([
				"copilot",
				"--",
				"plugin",
				"install",
				"Codagent-AI/agent-validator",
			]);

			spy.mockRestore();
		});

		it("returns success: true on success", async () => {
			const spy = spyOn(childProcess, "execFileSync").mockReturnValue("" as string & Buffer);

			const { installPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await installPlugin();
			expect(result.success).toBe(true);

			spy.mockRestore();
		});

		it("returns success: false with stderr on failure", async () => {
			const error = new Error("Command failed") as NodeJS.ErrnoException & {
				stderr?: string;
			};
			error.stderr = "plugin install failed";
			const spy = spyOn(childProcess, "execFileSync").mockImplementation(
				() => {
					throw error;
				},
			);

			const { installPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await installPlugin();
			expect(result.success).toBe(false);
			expect(result.stderr).toContain("plugin install failed");

			spy.mockRestore();
		});
	});

	describe("detectPlugin", () => {
		it("returns 'user' when agent-validator is in installed_plugins", async () => {
			tmpDir = await makeTmpDir();
			const copilotDir = path.join(tmpDir, ".copilot");
			await fs.mkdir(copilotDir, { recursive: true });
			await fs.writeFile(
				path.join(copilotDir, "config.json"),
				JSON.stringify({
					installed_plugins: [
						{
							name: "agent-validator",
							version: "1.4.0",
							cache_path:
								"~/.copilot/installed-plugins/_direct/Codagent-AI--agent-validator",
							source: {
								source: "github",
								repo: "Codagent-AI/agent-validator",
							},
						},
					],
				}),
			);

			const { detectPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await detectPlugin(tmpDir);
			expect(result).toBe("user");
		});

		it("returns 'user' when agent-gauntlet is in installed_plugins", async () => {
			tmpDir = await makeTmpDir();
			const copilotDir = path.join(tmpDir, ".copilot");
			await fs.mkdir(copilotDir, { recursive: true });
			await fs.writeFile(
				path.join(copilotDir, "config.json"),
				JSON.stringify({
					installed_plugins: [
						{
							name: "agent-gauntlet",
							version: "1.0.0",
						},
					],
				}),
			);

			const { detectPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await detectPlugin(tmpDir);
			expect(result).toBe("user");
		});

		it("returns null when config.json does not exist", async () => {
			tmpDir = await makeTmpDir();

			const { detectPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await detectPlugin(tmpDir);
			expect(result).toBeNull();
		});

		it("returns null when installed_plugins is empty", async () => {
			tmpDir = await makeTmpDir();
			const copilotDir = path.join(tmpDir, ".copilot");
			await fs.mkdir(copilotDir, { recursive: true });
			await fs.writeFile(
				path.join(copilotDir, "config.json"),
				JSON.stringify({ installed_plugins: [] }),
			);

			const { detectPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await detectPlugin(tmpDir);
			expect(result).toBeNull();
		});

		it("returns null when plugin name does not match", async () => {
			tmpDir = await makeTmpDir();
			const copilotDir = path.join(tmpDir, ".copilot");
			await fs.mkdir(copilotDir, { recursive: true });
			await fs.writeFile(
				path.join(copilotDir, "config.json"),
				JSON.stringify({
					installed_plugins: [
						{
							name: "some-other-plugin",
							version: "1.0.0",
						},
					],
				}),
			);

			const { detectPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await detectPlugin(tmpDir);
			expect(result).toBeNull();
		});

		it("returns null when config.json is malformed JSON", async () => {
			tmpDir = await makeTmpDir();
			const copilotDir = path.join(tmpDir, ".copilot");
			await fs.mkdir(copilotDir, { recursive: true });
			await fs.writeFile(
				path.join(copilotDir, "config.json"),
				"not valid json{{{",
			);

			const { detectPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await detectPlugin(tmpDir);
			expect(result).toBeNull();
		});

		it("defaults to os.homedir() when no homeDir provided", async () => {
			// When called without args, detectPlugin reads ~/.copilot/config.json.
			// We can't assert the return value (depends on dev machine state),
			// but verify it returns a valid scope or null without throwing.
			const { detectPlugin } = await import(
				"../../src/plugin/copilot-cli.js"
			);
			const result = await detectPlugin();
			expect(result === "user" || result === null).toBe(true);
		});
	});
});
