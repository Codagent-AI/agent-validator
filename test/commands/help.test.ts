import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerHelpCommand } from "../../src/commands/help.js";

describe("Help Command", () => {
	let program: Command;
	const originalConsoleLog = console.log;
	let logs: string[];

	beforeEach(() => {
		program = new Command();
		registerHelpCommand(program);
		logs = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
	});

	afterEach(() => {
		console.log = originalConsoleLog;
	});

	it("should register the help command", () => {
		const helpCmd = program.commands.find((cmd) => cmd.name() === "help");
		expect(helpCmd).toBeDefined();
		expect(helpCmd?.description()).toBe("Show help information");
	});

	it("should output help information when executed", async () => {
		const helpCmd = program.commands.find((cmd) => cmd.name() === "help");
		await helpCmd?.parseAsync(["help"]);

		const output = logs.join("\n");
		expect(output).toContain("Agent Validator");
		expect(output).toContain("Commands:");
		expect(output).toContain("run");
		expect(output).toContain("check");
		expect(output).toContain("review");
		expect(output).toContain("detect");
		expect(output).toContain("list");
		expect(output).toContain("health");
		expect(output).toContain("init");
	});
});
