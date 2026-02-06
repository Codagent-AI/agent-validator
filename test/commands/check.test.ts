import { beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerCheckCommand } from "../../src/commands/check.js";
import { checkGateSchema } from "../../src/config/schema.js";
import { resolveCheckCommand } from "../../src/gates/resolve-check-command.js";

describe("Check Command", () => {
	let program: Command;

	beforeEach(() => {
		program = new Command();
		registerCheckCommand(program);
	});

	it("should register the check command", () => {
		const checkCmd = program.commands.find((cmd) => cmd.name() === "check");
		expect(checkCmd).toBeDefined();
		expect(checkCmd?.description()).toBe(
			"Run only applicable checks for detected changes",
		);
	});

	it("should have correct options", () => {
		const checkCmd = program.commands.find((cmd) => cmd.name() === "check");
		expect(checkCmd?.options.some((opt) => opt.long === "--gate")).toBe(true);
		expect(checkCmd?.options.some((opt) => opt.long === "--commit")).toBe(true);
		expect(checkCmd?.options.some((opt) => opt.long === "--uncommitted")).toBe(
			true,
		);
	});
});

describe("checkGateSchema rerun_command", () => {
	it("accepts config with rerun_command", () => {
		const result = checkGateSchema.safeParse({
			command: "echo test",
			rerun_command: "echo rerun",
		});
		expect(result.success).toBe(true);
	});

	it("accepts config without rerun_command", () => {
		const result = checkGateSchema.safeParse({ command: "echo test" });
		expect(result.success).toBe(true);
	});

	it("rejects empty rerun_command", () => {
		const result = checkGateSchema.safeParse({
			command: "echo test",
			rerun_command: "",
		});
		expect(result.success).toBe(false);
	});
});

describe("resolveCheckCommand", () => {
	it("uses rerun_command when isRerun and falls back otherwise", () => {
		const config = { command: "echo first-run", rerun_command: "echo rerun" };

		// isRerun=true should use rerun_command
		expect(
			resolveCheckCommand(config, { baseBranch: "origin/main", isRerun: true }),
		).toBe("echo rerun");

		// isRerun=false should use command
		expect(resolveCheckCommand(config, { isRerun: false })).toBe(
			"echo first-run",
		);

		// isRerun=true without rerun_command should fall back to command
		expect(
			resolveCheckCommand(
				{ command: "echo first-run" },
				{ isRerun: true },
			),
		).toBe("echo first-run");

		// variable substitution applies to rerun_command
		expect(
			resolveCheckCommand(
				{ command: "run ${BASE_BRANCH}", rerun_command: "rerun ${BASE_BRANCH}" },
				{ baseBranch: "origin/main", isRerun: true },
			),
		).toBe("rerun origin/main");
	});
});
