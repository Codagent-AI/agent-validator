import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
	});

	it("description should say 'Archive logs' without 'reset execution state'", () => {
		const cleanCmd = program.commands.find((cmd) => cmd.name() === "clean");
		expect(cleanCmd?.description()).not.toContain("reset execution state");
		expect(cleanCmd?.description()).toContain("Archive logs");
	});

	it("should not call deleteExecutionState", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/commands/clean.ts"),
			"utf-8",
		);
		expect(sourceFile).not.toContain("deleteExecutionState");
	});
});
