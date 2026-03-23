import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { registerHealthCommand } from "../../src/commands/health.js";

const TEST_DIR = path.join(process.cwd(), `test-health-${Date.now()}`);
const GAUNTLET_DIR = path.join(TEST_DIR, ".validator");
const REVIEWS_DIR = path.join(GAUNTLET_DIR, "reviews");

describe("Health Command", () => {
	let program: Command;
	const originalConsoleLog = console.log;
	const originalCwd = process.cwd();
	let logs: string[];

	beforeAll(async () => {
		// Setup test directory structure
		await fs.mkdir(TEST_DIR, { recursive: true });
		await fs.mkdir(GAUNTLET_DIR, { recursive: true });
		await fs.mkdir(REVIEWS_DIR, { recursive: true });

		// Write config.yml
		await fs.writeFile(
			path.join(GAUNTLET_DIR, "config.yml"),
			`
base_branch: origin/main
log_dir: validator_logs
cli:
  default_preference:
    - gemini
entry_points:
  - path: .
`,
		);

		// Write review definition with CLI preference
		await fs.writeFile(
			path.join(REVIEWS_DIR, "security.md"),
			`---
cli_preference:
  - gemini
---

# Security Review
Review for security.
`,
		);
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	beforeEach(() => {
		program = new Command();
		registerHealthCommand(program);
		logs = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		process.chdir(TEST_DIR);
	});

	afterEach(() => {
		console.log = originalConsoleLog;
		process.chdir(originalCwd);
	});

	it("should register the health command", () => {
		const healthCmd = program.commands.find((cmd) => cmd.name() === "health");
		expect(healthCmd).toBeDefined();
		expect(healthCmd?.description()).toBe("Check CLI tool availability");
	});

	it("should run health check", async () => {
		const healthCmd = program.commands.find((cmd) => cmd.name() === "health");
		await healthCmd?.parseAsync(["health"]);

		const output = logs.join("\n");
		expect(output).toContain("Config validation:");
		expect(output).toContain("CLI Tool Health Check:");
	});
});
