import {
	describe,
	expect,
	it,
	beforeEach,
	afterEach,
	spyOn,
} from "bun:test";
import * as childProcess from "node:child_process";

// Helper: mock exec to return given stdout or fail
function mockExec(stdout: string, shouldFail = false) {
	return spyOn(childProcess, "exec").mockImplementation(
		// biome-ignore lint/suspicious/noExplicitAny: mock typing
		((...args: any[]) => {
			const callback = args[args.length - 1];
			if (typeof callback === "function") {
				if (shouldFail) {
					callback(new Error("Command failed"), "", "");
				} else {
					callback(null, stdout, "");
				}
			}
			return {} as any;
		}) as any,
	);
}

describe("GitHubCopilotAdapter.resolveModel", () => {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
	let adapter: any;
	let execSpy: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		const { GitHubCopilotAdapter } = await import(
			"../../src/cli-adapters/index.js"
		);
		adapter = new GitHubCopilotAdapter();
	});

	afterEach(() => {
		execSpy?.mockRestore();
	});

	it("resolves highest-versioned codex model", async () => {
		execSpy = mockExec(
			'Usage: copilot [options]\n\nOptions:\n  --model <model>  Choose a model (choices: "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex")\n',
		);
		const result = await adapter.resolveModel("codex", "low");
		expect(result).toBe("gpt-5.3-codex");
	});

	it("never prefers thinking variant (copilot has none)", async () => {
		execSpy = mockExec(
			'  --model <model>  Choose a model (choices: "opus-4.6", "opus-4.5")\n',
		);
		// Even with high thinking budget, Copilot should NOT prefer -thinking
		const result = await adapter.resolveModel("opus", "high");
		expect(result).toBe("opus-4.6");
	});

	it("returns undefined when no models match", async () => {
		execSpy = mockExec(
			'  --model <model>  Choose a model (choices: "gpt-5.3-codex")\n',
		);
		const result = await adapter.resolveModel("nonexistent", "off");
		expect(result).toBeUndefined();
	});

	it("returns undefined when CLI query fails", async () => {
		execSpy = mockExec("", true);
		const result = await adapter.resolveModel("codex", "off");
		expect(result).toBeUndefined();
	});

	it("uses segment matching", async () => {
		execSpy = mockExec(
			'  --model <model>  Choose a model (choices: "gpt-5.3-codex", "gpt-5.3-codecx")\n',
		);
		const result = await adapter.resolveModel("codex", "off");
		expect(result).toBe("gpt-5.3-codex");
	});

	it("excludes tier variants", async () => {
		execSpy = mockExec(
			'  --model <model>  Choose a model (choices: "gpt-5.3-codex", "gpt-5.3-codex-low", "gpt-5.3-codex-high")\n',
		);
		const result = await adapter.resolveModel("codex", "off");
		expect(result).toBe("gpt-5.3-codex");
	});
});
