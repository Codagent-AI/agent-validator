import { beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerCleanCommand } from "../../src/commands/clean.js";

describe("Clean Command", () => {
	let program: Command;

	beforeEach(() => {
		program = new Command();
		registerCleanCommand(program);
	});

	it("should register the clean command", () => {
		const cleanCmd = program.commands.find((cmd) => cmd.name() === "clean");
		expect(cleanCmd).toBeDefined();
		expect(cleanCmd?.description()).toBe(
			"Archive logs and reset execution state",
		);
	});
});
