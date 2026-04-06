import { describe, expect, it } from "bun:test";
import type { NormalizedEntryPoint } from "../../src/config/types.js";
import { EntryPointExpander } from "../../src/core/entry-point.js";

describe("EntryPointExpander", () => {
	const expander = new EntryPointExpander();

	it("should include root entry point if there are any changes", async () => {
		const entryPoints: NormalizedEntryPoint[] = [{ path: "." }];
		const changes = ["some/file.ts"];

		const result = await expander.expand(entryPoints, changes);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe(".");
	});

	it("should match fixed directory entry points", async () => {
		const entryPoints: NormalizedEntryPoint[] = [
			{ path: "apps/api" },
			{ path: "apps/web" },
		];
		const changes = ["apps/api/src/index.ts"];

		const result = await expander.expand(entryPoints, changes);

		expect(result.some((r) => r.path === "apps/api")).toBe(true);
		expect(result.some((r) => r.path === "apps/web")).toBe(false);
	});

	it("should match wildcard entry points", async () => {
		const entryPoints: NormalizedEntryPoint[] = [{ path: "packages/*" }];
		const changes = [
			"packages/ui/button.ts",
			"packages/utils/helper.ts",
			"other/file.ts",
		];

		const result = await expander.expand(entryPoints, changes);

		const paths = result.map((r) => r.path);
		expect(paths).toContain("packages/ui");
		expect(paths).toContain("packages/utils");
		expect(paths).not.toContain("packages/other");
	});

	it("should handle no changes", async () => {
		const entryPoints: NormalizedEntryPoint[] = [{ path: "." }];
		const changes: string[] = [];

		const result = await expander.expand(entryPoints, changes);

		expect(result).toHaveLength(0);
	});

	it("should exclude files based on exact pattern", async () => {
		const entryPoints: NormalizedEntryPoint[] = [
			{
				path: "src",
				exclude: ["src/ignore.ts"],
			},
		];
		const changes = ["src/include.ts", "src/ignore.ts"];

		const result = await expander.expand(entryPoints, changes);

		expect(result.some((r) => r.path === "src")).toBe(true);
	});

	it("should not match entry point if all changes are excluded", async () => {
		const entryPoints: NormalizedEntryPoint[] = [
			{
				path: "src",
				exclude: ["src/ignore.ts"],
			},
		];
		const changes = ["src/ignore.ts"];

		const result = await expander.expand(entryPoints, changes);

		// Root is added implicitly.
		expect(result.some((r) => r.path === ".")).toBe(true);
		expect(result.some((r) => r.path === "src")).toBe(false);
	});

	it("should exclude directory prefix", async () => {
		const entryPoints: NormalizedEntryPoint[] = [
			{
				path: "src",
				exclude: ["src/ignored_dir"],
			},
		];
		const changes = ["src/ignored_dir/file.ts"];

		const result = await expander.expand(entryPoints, changes);
		expect(result.some((r) => r.path === "src")).toBe(false);
	});

	it("should exclude glob patterns", async () => {
		const entryPoints: NormalizedEntryPoint[] = [
			{
				path: "src",
				exclude: ["**/*.md"],
			},
		];
		const changes = ["src/README.md"];

		const result = await expander.expand(entryPoints, changes);
		expect(result.some((r) => r.path === "src")).toBe(false);
	});

	it("should handle root exclusions", async () => {
		const entryPoints: NormalizedEntryPoint[] = [
			{
				path: ".",
				exclude: ["**/*.lock"],
			},
		];
		const changes = ["bun.lock"];

		const result = await expander.expand(entryPoints, changes);
		expect(result.some((r) => r.path === ".")).toBe(false);
	});
});
