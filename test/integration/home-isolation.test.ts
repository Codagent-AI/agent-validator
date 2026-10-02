import { describe, expect, it } from "bun:test";
import os from "node:os";
import { withIsolatedHome, withoutCiEnv } from "./helpers.js";

describe("withIsolatedHome", () => {
	it("replaces the real home so spawned validators never read the user's global config", () => {
		const env = withIsolatedHome({ HOME: os.homedir(), XDG_CONFIG_HOME: "/x" });
		expect(env.HOME).not.toBe(os.homedir());
		expect(env.HOME?.startsWith(os.tmpdir())).toBe(true);
		expect(env.XDG_CONFIG_HOME).toBeUndefined();
	});

	it("keeps a HOME the caller chose", () => {
		expect(withIsolatedHome({ HOME: "/tmp/custom-home" }).HOME).toBe("/tmp/custom-home");
	});
});

describe("withoutCiEnv", () => {
	it("clears CI detection variables so local scenarios pass on CI runners", () => {
		const env = withoutCiEnv({
			CI: "true",
			GITHUB_ACTIONS: "true",
			GITHUB_BASE_REF: "main",
			GITHUB_SHA: "abc123",
			PATH: "/usr/bin",
		});
		expect(env.CI).toBeUndefined();
		expect(env.GITHUB_ACTIONS).toBeUndefined();
		expect(env.GITHUB_BASE_REF).toBeUndefined();
		expect(env.GITHUB_SHA).toBeUndefined();
		expect(env.PATH).toBe("/usr/bin");
	});
});
