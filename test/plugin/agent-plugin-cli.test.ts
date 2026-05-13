import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

describe("agent-plugin-cli", () => {
	const originalAgentPluginBin = process.env.AGENT_PLUGIN_BIN;

	afterEach(() => {
		process.env.AGENT_PLUGIN_BIN = originalAgentPluginBin;
	});

	it("runs the bundled agent-plugin dependency by default", async () => {
		delete process.env.AGENT_PLUGIN_BIN;
		const spy = spyOn(childProcess, "execFileSync").mockReturnValue(
			"" as string & Buffer,
		);
		const packageJson = require.resolve("agent-plugin/package.json");
		const expectedBin = path.join(path.dirname(packageJson), "dist", "index.js");

		const { runAgentPlugin } = await import(
			"../../src/plugin/agent-plugin-cli.js"
		);
		runAgentPlugin(["add", "Codagent-AI/agent-validator", "--dry-run"]);

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toBe(process.execPath);
		expect(spy.mock.calls[0][1]).toEqual([
			expectedBin,
			"add",
			"Codagent-AI/agent-validator",
			"--dry-run",
		]);

		spy.mockRestore();
	});

	it("honors AGENT_PLUGIN_BIN for local development overrides", async () => {
		const overrideBin = path.join(
			process.cwd(),
			"tmp",
			"agent-plugin",
			"dist",
			"index.js",
		);
		process.env.AGENT_PLUGIN_BIN = overrideBin;
		const spy = spyOn(childProcess, "execFileSync").mockReturnValue(
			"" as string & Buffer,
		);

		const { runAgentPlugin } = await import(
			"../../src/plugin/agent-plugin-cli.js"
		);
		runAgentPlugin(["update", "Codagent-AI/agent-validator"]);

		expect(spy.mock.calls[0][1]).toEqual([
			overrideBin,
			"update",
			"Codagent-AI/agent-validator",
		]);

		spy.mockRestore();
	});

	it("updates by canonical repository source", async () => {
		const spy = spyOn(childProcess, "execFileSync").mockReturnValue(
			"" as string & Buffer,
		);

		const { updateAgentPluginForAgents } = await import(
			"../../src/plugin/agent-plugin-cli.js"
		);
		updateAgentPluginForAgents({
			agents: ["claude", "github-copilot", "codex"],
			scope: "project",
			yes: true,
		});

		const firstCall = spy.mock.calls[0];
		if (!firstCall) throw new Error("Expected agent-plugin to be executed");
		const args = firstCall[1];
		if (!args) throw new Error("Expected agent-plugin args");
		expect(args.slice(1)).toEqual([
			"update",
			"Codagent-AI/agent-validator",
			"--agent",
			"claude",
			"--agent",
			"copilot",
			"--agent",
			"codex",
			"--project",
			"--yes",
		]);

		spy.mockRestore();
	});
});
