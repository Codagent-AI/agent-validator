import { beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerRunCommand } from "../../src/commands/run.js";

describe("Run Command", () => {
	let program: Command;

	beforeEach(() => {
		program = new Command();
		registerRunCommand(program);
	});

	it("should register the run command", () => {
		const runCmd = program.commands.find((cmd) => cmd.name() === "run");
		expect(runCmd).toBeDefined();
		expect(runCmd?.description()).toBe("Run gates for detected changes");
	});

	it("should have correct options", () => {
		const runCmd = program.commands.find((cmd) => cmd.name() === "run");
		expect(runCmd?.options.some((opt) => opt.long === "--gate")).toBe(true);
		expect(runCmd?.options.some((opt) => opt.long === "--commit")).toBe(true);
		expect(runCmd?.options.some((opt) => opt.long === "--uncommitted")).toBe(
			true,
		);
	});

	it("should have --enable-review option", () => {
		const runCmd = program.commands.find((cmd) => cmd.name() === "run");
		expect(
			runCmd?.options.some((opt) => opt.long === "--enable-review"),
		).toBe(true);
	});

	it("should have -e short option for --enable-review", () => {
		const runCmd = program.commands.find((cmd) => cmd.name() === "run");
		const enableReviewOpt = runCmd?.options.find(
			(opt) => opt.long === "--enable-review",
		);
		expect(enableReviewOpt?.short).toBe("-e");
	});

	it("should have --report option", () => {
		const runCmd = program.commands.find((cmd) => cmd.name() === "run");
		expect(
			runCmd?.options.some((opt) => opt.long === "--report"),
		).toBe(true);
	});
});
