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

describe("CursorAdapter.resolveModel", () => {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
	let adapter: any;
	let execSpy: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		// Import from index.js to avoid circular dependency issues
		// (cursor.ts imports from index.ts which instantiates all adapters)
		const { CursorAdapter } = await import(
			"../../src/cli-adapters/index.js"
		);
		adapter = new CursorAdapter();
	});

	afterEach(() => {
		execSpy?.mockRestore();
	});

	it("resolves highest-versioned codex model", async () => {
		execSpy = mockExec(
			"gpt-5.3-codex - GPT 5.3 Codex\ngpt-5.3-codex-low - GPT 5.3 Codex Low\ngpt-5.3-codex-high - GPT 5.3 Codex High\ngpt-5.2-codex - GPT 5.2 Codex\n",
		);
		const result = await adapter.resolveModel("codex", "low");
		expect(result).toBe("gpt-5.3-codex");
	});

	it("prefers thinking variant when thinking_budget is active", async () => {
		execSpy = mockExec(
			"opus-4.6 - Opus 4.6\nopus-4.6-thinking - Opus 4.6 Thinking\nopus-4.5 - Opus 4.5\nopus-4.5-thinking - Opus 4.5 Thinking\n",
		);
		const result = await adapter.resolveModel("opus", "high");
		expect(result).toBe("opus-4.6-thinking");
	});

	it("falls back to non-thinking when thinking variant unavailable", async () => {
		execSpy = mockExec("gpt-5.3-codex - GPT 5.3 Codex\n");
		const result = await adapter.resolveModel("codex", "high");
		expect(result).toBe("gpt-5.3-codex");
	});

	it("uses segment matching (codex does not match codecx)", async () => {
		execSpy = mockExec(
			"gpt-5.3-codex - GPT 5.3 Codex\ngpt-5.3-codecx - GPT 5.3 Codecx\n",
		);
		const result = await adapter.resolveModel("codex", "off");
		expect(result).toBe("gpt-5.3-codex");
	});

	it("returns undefined when no models match", async () => {
		execSpy = mockExec("gpt-5.3-codex - GPT 5.3 Codex\n");
		const result = await adapter.resolveModel("nonexistent", "off");
		expect(result).toBeUndefined();
	});

	it("returns undefined when CLI query fails", async () => {
		execSpy = mockExec("", true);
		const result = await adapter.resolveModel("codex", "off");
		expect(result).toBeUndefined();
	});

	it("does not prefer thinking variant when thinking_budget is off", async () => {
		execSpy = mockExec(
			"opus-4.6 - Opus 4.6\nopus-4.6-thinking - Opus 4.6 Thinking\n",
		);
		const result = await adapter.resolveModel("opus", "off");
		expect(result).toBe("opus-4.6");
	});

	it("excludes -fast tier variants", async () => {
		execSpy = mockExec(
			"gpt-5.3-codex - GPT 5.3 Codex\ngpt-5.3-codex-fast - GPT 5.3 Codex Fast\n",
		);
		const result = await adapter.resolveModel("codex", "off");
		expect(result).toBe("gpt-5.3-codex");
	});

	it("excludes -xhigh tier variants", async () => {
		execSpy = mockExec(
			"gpt-5.3-codex - GPT 5.3 Codex\ngpt-5.3-codex-xhigh - GPT 5.3 Codex XHigh\n",
		);
		const result = await adapter.resolveModel("codex", "off");
		expect(result).toBe("gpt-5.3-codex");
	});
});
