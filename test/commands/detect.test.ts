import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { registerDetectCommand } from "../../src/commands/detect.js";

describe("Detect Command", () => {
	let program: Command;
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;
	let logs: string[];
	let errors: string[];

	beforeEach(() => {
		program = new Command();
		registerDetectCommand(program);
		logs = [];
		errors = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		console.error = (...args: unknown[]) => {
			errors.push(args.join(" "));
		};
	});

	afterEach(() => {
		console.log = originalConsoleLog;
		console.error = originalConsoleError;
	});

	it("should register the detect command", () => {
		const detectCmd = program.commands.find((cmd) => cmd.name() === "detect");
		expect(detectCmd).toBeDefined();
		expect(detectCmd?.description()).toBe(
			"Show what gates would run for detected changes (without executing them)",
		);
		expect(detectCmd?.options.some((opt) => opt.long === "--commit")).toBe(
			true,
		);
		expect(detectCmd?.options.some((opt) => opt.long === "--uncommitted")).toBe(
			true,
		);
	});

	it("threads loaded retention through context-change cleanup", async () => {
		const source = await readFile(
			path.join(import.meta.dir, "../../src/commands/detect.ts"),
			"utf8",
		);
		expect(source).toMatch(/autoCleanIfNeeded\([\s\S]*?maxPreviousLogs/);
		expect(source).toMatch(/performAutoClean\(logDir, result, maxPreviousLogs\)/);
		expect(source).toMatch(/config\.project\.max_previous_logs/);
	});
});
