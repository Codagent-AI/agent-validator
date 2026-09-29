import { describe, expect, it } from "bun:test";
import os from "node:os";
import { withIsolatedHome } from "./helpers.js";

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
