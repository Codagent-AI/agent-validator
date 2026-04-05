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
import { registerListCommand } from "../../src/commands/list.js";

const TEST_DIR = path.join(process.cwd(), `test-list-${Date.now()}`);
const VALIDATOR_DIR = path.join(TEST_DIR, ".validator");
const CHECKS_DIR = path.join(VALIDATOR_DIR, "checks");
const REVIEWS_DIR = path.join(VALIDATOR_DIR, "reviews");

describe("List Command", () => {
	let program: Command;
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;
	const originalCwd = process.cwd();
	let logs: string[];
	let errors: string[];

	beforeAll(async () => {
		// Setup test directory structure
		await fs.mkdir(TEST_DIR, { recursive: true });
		await fs.mkdir(VALIDATOR_DIR, { recursive: true });
		await fs.mkdir(CHECKS_DIR, { recursive: true });
		await fs.mkdir(REVIEWS_DIR, { recursive: true });

		// Write config.yml
		await fs.writeFile(
			path.join(VALIDATOR_DIR, "config.yml"),
			`
base_branch: origin/main
log_dir: validator_logs
cli:
  default_preference:
    - gemini
entry_points:
  - path: src/
    checks:
      - lint
    reviews:
      - security
`,
		);

		// Write check definition
		await fs.writeFile(
			path.join(CHECKS_DIR, "lint.yml"),
			`
name: lint
command: npm run lint
working_directory: .
`,
		);

		// Write review definition
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
		registerListCommand(program);
		logs = [];
		errors = [];
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		console.error = (...args: unknown[]) => {
			errors.push(args.join(" "));
		};
		process.chdir(TEST_DIR);
	});

	afterEach(() => {
		console.log = originalConsoleLog;
		console.error = originalConsoleError;
		process.chdir(originalCwd);
	});

	it("should register the list command", () => {
		const listCmd = program.commands.find((cmd) => cmd.name() === "list");
		expect(listCmd).toBeDefined();
		expect(listCmd?.description()).toBe("List configured gates");
	});

	it("should list check gates, review gates, and entry points", async () => {
		const listCmd = program.commands.find((cmd) => cmd.name() === "list");
		await listCmd?.parseAsync(["list"]);

		const output = logs.join("\n");
		expect(output).toContain("Check Gates:");
		expect(output).toContain("lint");
		expect(output).toContain("Review Gates:");
		expect(output).toContain("security");
		expect(output).toContain("gemini");
		expect(output).toContain("Entry Points:");
		expect(output).toContain("src/");
	});
});
