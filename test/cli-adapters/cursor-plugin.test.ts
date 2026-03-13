import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CursorAdapter } from "../../src/cli-adapters/cursor.js";

describe("CursorAdapter plugin lifecycle", () => {
	const adapter = new CursorAdapter();
	const tmpDirs: string[] = [];

	async function makeTmpDir(): Promise<string> {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-plugin-test-"));
		tmpDirs.push(dir);
		return dir;
	}

	afterEach(async () => {
		for (const dir of tmpDirs) {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
		tmpDirs.length = 0;
	});

	describe("getProjectSkillDir", () => {
		it("returns .cursor/skills", () => {
			expect(adapter.getProjectSkillDir()).toBe(".cursor/skills");
		});
	});

	describe("getUserSkillDir", () => {
		it("returns a path ending in .cursor/skills", () => {
			const result = adapter.getUserSkillDir();
			expect(result).not.toBeNull();
			expect(result!.endsWith(path.join(".cursor", "skills"))).toBe(true);
		});
	});

	describe("detectPlugin", () => {
		it("returns null when no plugin files exist", async () => {
			const tmpDir = await makeTmpDir();
			const result = await adapter.detectPlugin(tmpDir);
			// User-scope check uses os.homedir() which is immutable in Bun,
			// so this test relies on no user-scope plugin being installed.
			// Project-scope is tested via the isolated temp dir.
			expect(result).toBeNull();
		});

		it("returns 'project' when project plugin file exists", async () => {
			const tmpDir = await makeTmpDir();
			const pluginDir = path.join(
				tmpDir,
				".cursor",
				"plugins",
				"agent-gauntlet",
				".cursor-plugin",
			);
			await fs.mkdir(pluginDir, { recursive: true });
			await fs.writeFile(path.join(pluginDir, "plugin.json"), "{}");

			const result = await adapter.detectPlugin(tmpDir);
			expect(result).toBe("project");
		});

		it("prefers project scope over user scope", async () => {
			// When both scopes exist, project scope should be returned first
			// (project check runs before user check in detectPlugin)
			const tmpDir = await makeTmpDir();
			const pluginDir = path.join(
				tmpDir,
				".cursor",
				"plugins",
				"agent-gauntlet",
				".cursor-plugin",
			);
			await fs.mkdir(pluginDir, { recursive: true });
			await fs.writeFile(path.join(pluginDir, "plugin.json"), "{}");

			const result = await adapter.detectPlugin(tmpDir);
			// Even if a user-scope plugin exists, project scope takes priority
			expect(result).toBe("project");
		});
	});

	describe("installPlugin", () => {
		it("copies files to the correct location for project scope", async () => {
			const tmpDir = await makeTmpDir();
			const result = await adapter.installPlugin("project", tmpDir);
			expect(result.success).toBe(true);

			// Verify plugin manifest was copied
			const pluginJson = path.join(
				tmpDir,
				".cursor",
				"plugins",
				"agent-gauntlet",
				".cursor-plugin",
				"plugin.json",
			);
			const stat = await fs.stat(pluginJson);
			expect(stat.isFile()).toBe(true);

			// Verify skills were copied
			const skillsDir = path.join(
				tmpDir,
				".cursor",
				"plugins",
				"agent-gauntlet",
				"skills",
			);
			const skillsStat = await fs.stat(skillsDir);
			expect(skillsStat.isDirectory()).toBe(true);

			// Verify hooks were copied
			const hooksFile = path.join(
				tmpDir,
				".cursor",
				"plugins",
				"agent-gauntlet",
				"hooks",
				"hooks.json",
			);
			const hooksStat = await fs.stat(hooksFile);
			expect(hooksStat.isFile()).toBe(true);
		});

		// Note: user-scope installPlugin cannot be isolated in tests because
		// Bun's os.homedir() is immutable at runtime (ignores process.env.HOME
		// changes). The project-scope test above validates the same file-copy
		// logic that user-scope uses.
	});

	describe("getManualInstallInstructions", () => {
		it("returns instructions mentioning user target path", () => {
			const instructions = adapter.getManualInstallInstructions("user");
			expect(instructions.length).toBeGreaterThan(0);
			expect(
				instructions.some((i) =>
					i.includes("~/.cursor/plugins/agent-gauntlet/"),
				),
			).toBe(true);
		});

		it("returns instructions mentioning project target path", () => {
			const instructions = adapter.getManualInstallInstructions("project");
			expect(instructions.length).toBeGreaterThan(0);
			expect(
				instructions.some((i) =>
					i.includes(".cursor/plugins/agent-gauntlet/"),
				),
			).toBe(true);
		});
	});
});
