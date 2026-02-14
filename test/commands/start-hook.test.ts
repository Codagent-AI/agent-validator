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

const TEST_DIR = path.join(process.cwd(), `test-start-hook-${Date.now()}`);

const { registerStartHookCommand } = await import(
	"../../src/commands/start-hook.js"
);

describe("Start Hook Command", () => {
	let program: Command;
	const originalCwd = process.cwd();
	const originalConsoleLog = console.log;
	let output: string[];

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	beforeEach(() => {
		program = new Command();
		program.exitOverride();
		registerStartHookCommand(program);
		output = [];
		console.log = (...args: unknown[]) => {
			output.push(args.join(" "));
		};
		process.chdir(TEST_DIR);
	});

	afterEach(async () => {
		console.log = originalConsoleLog;
		process.chdir(originalCwd);
		await fs.rm(path.join(TEST_DIR, ".gauntlet"), {
			recursive: true,
			force: true,
		}).catch(() => {});
	});

	describe("Non-gauntlet project", () => {
		it("should exit silently when no .gauntlet/config.yml exists", async () => {
			await program.parseAsync(["node", "test", "start-hook"]);
			expect(output.length).toBe(0);
		});
	});

	describe("Gauntlet project with Claude adapter", () => {
		beforeEach(async () => {
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"checks:\n  - lint\n",
			);
		});

		it("should output valid Claude Code SessionStart JSON with --adapter claude", async () => {
			await program.parseAsync(["node", "test", "start-hook", "--adapter", "claude"]);
			const raw = output.join("\n");
			const parsed = JSON.parse(raw);
			expect(parsed.hookSpecificOutput).toBeDefined();
			expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
			expect(typeof parsed.hookSpecificOutput.additionalContext).toBe("string");
		});

		it("should default to Claude JSON format when no --adapter flag", async () => {
			await program.parseAsync(["node", "test", "start-hook"]);
			const raw = output.join("\n");
			const parsed = JSON.parse(raw);
			expect(parsed.hookSpecificOutput).toBeDefined();
			expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
		});

		it("should default to Claude JSON format with unrecognized --adapter value", async () => {
			await program.parseAsync(["node", "test", "start-hook", "--adapter", "vscode"]);
			const raw = output.join("\n");
			const parsed = JSON.parse(raw);
			expect(parsed.hookSpecificOutput).toBeDefined();
		});

		it("should output plain text with --adapter cursor", async () => {
			await program.parseAsync(["node", "test", "start-hook", "--adapter", "cursor"]);
			const raw = output.join("\n");
			// Should NOT be valid JSON with hookSpecificOutput
			let isClaudeFormat = false;
			try {
				const parsed = JSON.parse(raw);
				if (parsed.hookSpecificOutput) isClaudeFormat = true;
			} catch {
				// Not JSON = good for cursor
			}
			expect(isClaudeFormat).toBe(false);
			expect(raw).toContain("gauntlet");
		});

		it("should include invocation conditions in context message", async () => {
			await program.parseAsync(["node", "test", "start-hook"]);
			const raw = output.join("\n");
			const parsed = JSON.parse(raw);
			const msg = parsed.hookSpecificOutput.additionalContext;
			expect(msg).toContain("/gauntlet-run");
			expect(msg).toContain("coding task");
		});

		it("should include exclusion conditions in context message", async () => {
			await program.parseAsync(["node", "test", "start-hook"]);
			const raw = output.join("\n");
			const parsed = JSON.parse(raw);
			const msg = parsed.hookSpecificOutput.additionalContext;
			expect(msg).toContain("read-only");
		});

		it("should wrap context message in IMPORTANT tags", async () => {
			await program.parseAsync(["node", "test", "start-hook"]);
			const raw = output.join("\n");
			const parsed = JSON.parse(raw);
			const msg = parsed.hookSpecificOutput.additionalContext;
			expect(msg).toContain("<IMPORTANT>");
			expect(msg).toContain("</IMPORTANT>");
		});

		it("should favor false positives over false negatives", async () => {
			await program.parseAsync(["node", "test", "start-hook"]);
			const raw = output.join("\n");
			const parsed = JSON.parse(raw);
			const msg = parsed.hookSpecificOutput.additionalContext;
			expect(msg).toContain("unsure");
		});
	});

	describe("Malformed config", () => {
		it("should exit 0 with no output when config.yml is empty", async () => {
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, ".gauntlet", "config.yml"), "");
			await program.parseAsync(["node", "test", "start-hook"]);
			expect(output.length).toBe(0);
		});

		it("should exit 0 with no output when config.yml has invalid YAML", async () => {
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, ".gauntlet", "config.yml"), ": : : invalid");
			await program.parseAsync(["node", "test", "start-hook"]);
			expect(output.length).toBe(0);
		});
	});

	describe("Stdin behavior", () => {
		it("should not read from stdin", async () => {
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, ".gauntlet", "config.yml"), "checks:\n  - lint\n");
			await program.parseAsync(["node", "test", "start-hook"]);
			expect(output.length).toBeGreaterThan(0);
		});
	});
});
