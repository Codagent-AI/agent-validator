import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("Cursor plugin assets", () => {
	describe(".cursor-plugin/plugin.json", () => {
		const pluginPath = join(ROOT, ".cursor-plugin/plugin.json");

		test("exists", () => {
			expect(existsSync(pluginPath)).toBe(true);
		});

		test("has required fields", () => {
			const plugin = JSON.parse(readFileSync(pluginPath, "utf-8"));
			expect(plugin.name).toBe("agent-gauntlet");
			expect(plugin.version).toBeString();
			expect(plugin.description).toBeString();
			expect(plugin.license).toBeString();
		});

		test("version matches package.json", () => {
			const plugin = JSON.parse(readFileSync(pluginPath, "utf-8"));
			const pkg = JSON.parse(
				readFileSync(join(ROOT, "package.json"), "utf-8"),
			);
			expect(plugin.version).toBe(pkg.version);
		});
	});

	describe(".cursor-plugin/ directory", () => {
		test("contains only plugin.json", () => {
			const files = readdirSync(join(ROOT, ".cursor-plugin"));
			expect(files).toEqual(["plugin.json"]);
		});
	});

	describe("hooks/cursor-hooks.json", () => {
		const hooksPath = join(ROOT, "hooks/cursor-hooks.json");

		test("exists", () => {
			expect(existsSync(hooksPath)).toBe(true);
		});

		test("has empty hooks object", () => {
			const hooks = JSON.parse(readFileSync(hooksPath, "utf-8"));
			expect(hooks.hooks).toBeDefined();
			expect(Object.keys(hooks.hooks)).toHaveLength(0);
		});
	});

	describe("package.json files array", () => {
		test("includes .cursor-plugin", () => {
			const pkg = JSON.parse(
				readFileSync(join(ROOT, "package.json"), "utf-8"),
			);
			expect(pkg.files).toContain(".cursor-plugin");
		});
	});
});
