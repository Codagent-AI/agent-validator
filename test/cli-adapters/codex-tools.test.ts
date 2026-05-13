import { describe, expect, it } from "bun:test";
import { CodexAdapter } from "../../src/cli-adapters/codex.js";

describe("CodexAdapter tools-off execution", () => {
	it("ignores user config when tool use is disabled", async () => {
		const adapter = new CodexAdapter();
		const args = adapter["buildArgs"](false, undefined, undefined);

		expect(args).toContain("--disable");
		expect(args).toContain("shell_tool");
		expect(args).toContain("--ignore-user-config");
	});
});
