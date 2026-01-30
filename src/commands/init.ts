import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";
import { type CLIAdapter, getAllAdapters } from "../cli-adapters/index.js";
import { exists } from "./shared.js";

const MAX_PROMPT_ATTEMPTS = 10;

const GAUNTLET_COMMAND_CONTENT = `---
description: Run the full verification gauntlet
allowed-tools: Bash
---
<!--
  REVIEW TRUST LEVEL
  Controls how aggressively the agent acts on AI reviewer feedback.
  Change the trust_level value below to one of: high, medium, low

  - high:   Fix all issues unless you strongly disagree or have low confidence the human wants the change.
  - medium: Fix issues you reasonably agree with or believe the human wants fixed. (DEFAULT)
  - low:    Fix only issues you strongly agree with or are confident the human wants fixed.
-->
<!-- trust_level: medium -->

# /gauntlet
Execute the autonomous verification suite.

**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.

1. Run \`agent-gauntlet run\`.
2. If it fails:
   - Check the console output for "Fix instructions: available" messages.
   - Read the log files in \`gauntlet_logs/\` to understand exactly what went wrong.
   - If fix instructions are available, they will be in the log file under a "--- Fix Instructions ---" section—carefully read and apply them FIRST before attempting other fixes.
3. Fix any code or logic errors found by the tools or AI reviewers, prioritizing higher-priority violations (critical > high > medium > low).
4. Apply the trust level above when deciding whether to act on AI reviewer feedback. If you skip an issue due to the trust threshold, report it with a brief explanation (e.g., "Skipped: [issue summary] — reason: [stylistic/subjective/disagree]").
5. Do NOT commit your changes yet—keep them uncommitted so the next run can verify them.
6. Run \`agent-gauntlet run\` again to verify your fixes. It will detect existing logs and automatically switch to verification mode (uncommitted changes + previous failure context).
7. Repeat steps 2-6 until one of the following termination conditions is met:
   - All gates pass (logs are automatically archived)
   - You disagree with remaining failures (ask the human how to proceed)
   - Still failing after 3 attempts
8. Once all gates pass, do NOT commit or push your changes—await the human's review and explicit instruction to commit.
`;

type InstallLevel = "none" | "project" | "user";

interface InitOptions {
	yes?: boolean;
}

interface InitConfig {
	baseBranch: string;
	sourceDir: string;
	lintCmd: string | null; // null means not selected, empty string means selected but blank (TODO)
	testCmd: string | null; // null means not selected, empty string means selected but blank (TODO)
	selectedAdapters: CLIAdapter[];
}

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description("Initialize .gauntlet configuration")
		.option(
			"-y, --yes",
			"Skip prompts and use defaults (all available CLIs, source: ., no extra checks)",
		)
		.action(async (options: InitOptions) => {
			const projectRoot = process.cwd();
			const targetDir = path.join(projectRoot, ".gauntlet");

			if (await exists(targetDir)) {
				console.log(chalk.yellow(".gauntlet directory already exists."));
				return;
			}

			// 1. CLI Detection
			console.log("Detecting available CLI agents...");
			const availableAdapters = await detectAvailableCLIs();

			if (availableAdapters.length === 0) {
				console.log();
				console.log(
					chalk.red("Error: No CLI agents found. Install at least one:"),
				);
				console.log(
					"  - Claude: https://docs.anthropic.com/en/docs/claude-code",
				);
				console.log("  - Gemini: https://github.com/google-gemini/gemini-cli");
				console.log("  - Codex: https://github.com/openai/codex");
				console.log();
				return;
			}

			let config: InitConfig;

			if (options.yes) {
				config = {
					baseBranch: "origin/main",
					sourceDir: ".",
					lintCmd: null,
					testCmd: null,
					selectedAdapters: availableAdapters,
				};
			} else {
				config = await promptForConfig(availableAdapters);
			}

			// Create base config structure
			await fs.mkdir(targetDir);
			await fs.mkdir(path.join(targetDir, "checks"));
			await fs.mkdir(path.join(targetDir, "reviews"));

			// 4. Commented Config Templates
			// Generate config.yml
			const configContent = generateConfigYml(config);
			await fs.writeFile(path.join(targetDir, "config.yml"), configContent);
			console.log(chalk.green("Created .gauntlet/config.yml"));

			// Generate check files if selected
			if (config.lintCmd !== null) {
				const lintContent = `name: lint
command: ${config.lintCmd || "# command: TODO - add your lint command (e.g., npm run lint)"}
# parallel: false
# run_in_ci: true
# run_locally: true
# timeout: 300
`;
				await fs.writeFile(
					path.join(targetDir, "checks", "lint.yml"),
					lintContent,
				);
				console.log(chalk.green("Created .gauntlet/checks/lint.yml"));
			}

			if (config.testCmd !== null) {
				const testContent = `name: unit-tests
command: ${config.testCmd || "# command: TODO - add your test command (e.g., npm test)"}
# parallel: false
# run_in_ci: true
# run_locally: true
# timeout: 300
`;
				await fs.writeFile(
					path.join(targetDir, "checks", "unit-tests.yml"),
					testContent,
				);
				console.log(chalk.green("Created .gauntlet/checks/unit-tests.yml"));
			}

			// 5. Improved Default Code Review Prompt
			const reviewContent = `---
num_reviews: 1
# parallel: true
# timeout: 300
# cli_preference:
#   - ${config.selectedAdapters[0]?.name || "claude"}
---

# Code Review

Review the diff for quality issues:

- **Bugs**: Logic errors, null handling, edge cases, race conditions
- **Security**: Input validation, secrets exposure, injection risks
- **Maintainability**: Unclear code, missing error handling, duplication
- **Performance**: Unnecessary work, N+1 queries, missing optimizations

For each issue: cite file:line, explain the problem, suggest a fix.
`;
			await fs.writeFile(
				path.join(targetDir, "reviews", "code-quality.md"),
				reviewContent,
			);
			console.log(chalk.green("Created .gauntlet/reviews/code-quality.md"));

			// Write the canonical gauntlet command file
			const canonicalCommandPath = path.join(targetDir, "run_gauntlet.md");
			await fs.writeFile(canonicalCommandPath, GAUNTLET_COMMAND_CONTENT);
			console.log(chalk.green("Created .gauntlet/run_gauntlet.md"));

			// Handle command installation
			if (options.yes) {
				// Default: install at project level for all selected agents (if they support it)
				const adaptersToInstall = config.selectedAdapters.filter(
					(a) => a.getProjectCommandDir() !== null,
				);
				if (adaptersToInstall.length > 0) {
					await installCommands(
						"project",
						adaptersToInstall.map((a) => a.name),
						projectRoot,
						canonicalCommandPath,
					);
				}
			} else {
				// Interactive prompts - passing available adapters to avoid re-checking or offering unavailable ones
				await promptAndInstallCommands(
					projectRoot,
					canonicalCommandPath,
					availableAdapters,
				);
			}

			// Handle stop hook installation (only in interactive mode)
			if (!options.yes) {
				await promptAndInstallStopHook(projectRoot);
			}
		});
}

async function detectAvailableCLIs(): Promise<CLIAdapter[]> {
	const allAdapters = getAllAdapters();
	const available: CLIAdapter[] = [];

	for (const adapter of allAdapters) {
		const isAvailable = await adapter.isAvailable();
		if (isAvailable) {
			console.log(chalk.green(`  ✓ ${adapter.name}`));
			available.push(adapter);
		} else {
			console.log(chalk.dim(`  ✗ ${adapter.name} (not installed)`));
		}
	}
	return available;
}

async function promptForConfig(
	availableAdapters: CLIAdapter[],
): Promise<InitConfig> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const question = (prompt: string): Promise<string> => {
		return new Promise((resolve) => {
			rl.question(prompt, (answer) => {
				resolve(answer?.trim() ?? "");
			});
		});
	};

	try {
		// CLI Selection
		console.log();
		console.log("Which CLIs would you like to use?");
		availableAdapters.forEach((adapter, i) => {
			console.log(`  ${i + 1}) ${adapter.name}`);
		});
		console.log(`  ${availableAdapters.length + 1}) All`);

		let selectedAdapters: CLIAdapter[] = [];
		let attempts = 0;
		while (true) {
			attempts++;
			if (attempts > MAX_PROMPT_ATTEMPTS)
				throw new Error("Too many invalid attempts");
			const answer = await question(`(comma-separated, e.g., 1,2): `);
			const selections = answer
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s);

			if (selections.length === 0) {
				// Default to all if empty? Or force selection? Plan says "Which CLIs...".
				// Let's assume user must pick or we default to all if they just hit enter?
				// Actually, usually enter means default. Let's make All the default if just Enter.
				selectedAdapters = availableAdapters;
				break;
			}

			let valid = true;
			const chosen: CLIAdapter[] = [];

			for (const sel of selections) {
				const num = parseInt(sel, 10);
				if (
					Number.isNaN(num) ||
					num < 1 ||
					num > availableAdapters.length + 1
				) {
					console.log(chalk.yellow(`Invalid selection: ${sel}`));
					valid = false;
					break;
				}
				if (num === availableAdapters.length + 1) {
					chosen.push(...availableAdapters);
				} else {
					chosen.push(availableAdapters[num - 1]);
				}
			}

			if (valid) {
				selectedAdapters = [...new Set(chosen)];
				break;
			}
		}

		// Base Branch
		console.log();
		const baseBranchInput = await question(
			"Enter your base branch (e.g., origin/main, origin/develop) [default: origin/main]: ",
		);
		const baseBranch = baseBranchInput || "origin/main";

		// Source Directory
		console.log();
		const sourceDirInput = await question(
			"Enter your source directory (e.g., src, lib, .) [default: .]: ",
		);
		const sourceDir = sourceDirInput || ".";

		// Lint Check
		console.log();
		const addLint = await question(
			"Would you like to add a linting check? [y/N]: ",
		);
		let lintCmd: string | null = null;
		if (addLint.toLowerCase().startsWith("y")) {
			lintCmd = await question("Enter lint command (blank to fill later): ");
		}

		// Unit Test Check
		console.log();
		const addTest = await question(
			"Would you like to add a unit test check? [y/N]: ",
		);
		let testCmd: string | null = null;
		if (addTest.toLowerCase().startsWith("y")) {
			testCmd = await question("Enter test command (blank to fill later): ");
		}

		rl.close();
		return {
			baseBranch,
			sourceDir,
			lintCmd,
			testCmd,
			selectedAdapters,
		};
	} catch (error) {
		rl.close();
		throw error;
	}
}

function generateConfigYml(config: InitConfig): string {
	const cliList = config.selectedAdapters
		.map((a) => `    - ${a.name}`)
		.join("\n");

	let entryPoints = "";

	// If we have checks, we need a source directory entry point
	if (config.lintCmd !== null || config.testCmd !== null) {
		entryPoints += `  - path: "${config.sourceDir}"
    checks:\n`;
		if (config.lintCmd !== null) entryPoints += `      - lint\n`;
		if (config.testCmd !== null) entryPoints += `      - unit-tests\n`;
	}

	// Always include root entry point for reviews
	entryPoints += `  - path: "."
    reviews:
      - code-quality`;

	return `base_branch: ${config.baseBranch}
log_dir: gauntlet_logs

# Run gates in parallel when possible (default: true)
# allow_parallel: true

cli:
  default_preference:
${cliList}
  # Check CLI usage quota before running (if unavailable, uses next in list)
  # check_usage_limit: false

entry_points:
${entryPoints}
`;
}

async function promptAndInstallCommands(
	projectRoot: string,
	canonicalCommandPath: string,
	availableAdapters: CLIAdapter[],
): Promise<void> {
	// Only proceed if we have available adapters
	if (availableAdapters.length === 0) return;

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const question = (prompt: string): Promise<string> => {
		return new Promise((resolve) => {
			rl.question(prompt, (answer) => {
				resolve(answer?.trim() ?? "");
			});
		});
	};

	try {
		console.log();
		console.log(chalk.bold("CLI Agent Command Setup"));
		console.log(
			chalk.dim(
				"The gauntlet command can be installed for CLI agents so you can run /gauntlet directly.",
			),
		);
		console.log();

		// Question 1: Install level
		console.log("Where would you like to install the /gauntlet command?");
		console.log("  1) Don't install commands");
		console.log(
			"  2) Project level (in this repo's .claude/commands, .gemini/commands, etc.)",
		);
		console.log(
			"  3) User level (in ~/.claude/commands, ~/.gemini/commands, etc.)",
		);
		console.log();

		let installLevel: InstallLevel = "none";
		let answer = await question("Select option [1-3]: ");
		let installLevelAttempts = 0;

		while (true) {
			installLevelAttempts++;
			if (installLevelAttempts > MAX_PROMPT_ATTEMPTS)
				throw new Error("Too many invalid attempts");

			if (answer === "1") {
				installLevel = "none";
				break;
			} else if (answer === "2") {
				installLevel = "project";
				break;
			} else if (answer === "3") {
				installLevel = "user";
				break;
			} else {
				console.log(chalk.yellow("Please enter 1, 2, or 3"));
				answer = await question("Select option [1-3]: ");
			}
		}

		if (installLevel === "none") {
			console.log(chalk.dim("\nSkipping command installation."));
			rl.close();
			return;
		}

		// Filter available adapters based on install level support
		const installableAdapters =
			installLevel === "project"
				? availableAdapters.filter((a) => a.getProjectCommandDir() !== null)
				: availableAdapters.filter((a) => a.getUserCommandDir() !== null);

		if (installableAdapters.length === 0) {
			console.log(
				chalk.yellow(
					`No available agents support ${installLevel}-level commands.`,
				),
			);
			rl.close();
			return;
		}

		console.log();
		console.log("Which CLI agents would you like to install the command for?");
		installableAdapters.forEach((adapter, i) => {
			console.log(`  ${i + 1}) ${adapter.name}`);
		});
		console.log(`  ${installableAdapters.length + 1}) All of the above`);
		console.log();

		let selectedAgents: string[] = [];
		answer = await question(
			`Select options (comma-separated, e.g., 1,2 or ${installableAdapters.length + 1} for all): `,
		);
		let agentSelectionAttempts = 0;

		while (true) {
			agentSelectionAttempts++;
			if (agentSelectionAttempts > MAX_PROMPT_ATTEMPTS)
				throw new Error("Too many invalid attempts");

			const selections = answer
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s);

			if (selections.length === 0) {
				console.log(chalk.yellow("Please select at least one option"));
				answer = await question(
					`Select options (comma-separated, e.g., 1,2 or ${installableAdapters.length + 1} for all): `,
				);
				continue;
			}

			let valid = true;
			const agents: string[] = [];

			for (const sel of selections) {
				const num = parseInt(sel, 10);
				if (
					Number.isNaN(num) ||
					num < 1 ||
					num > installableAdapters.length + 1
				) {
					console.log(chalk.yellow(`Invalid selection: ${sel}`));
					valid = false;
					break;
				}
				if (num === installableAdapters.length + 1) {
					agents.push(...installableAdapters.map((a) => a.name));
				} else {
					agents.push(installableAdapters[num - 1].name);
				}
			}

			if (valid) {
				selectedAgents = [...new Set(agents)]; // Dedupe
				break;
			}
			answer = await question(
				`Select options (comma-separated, e.g., 1,2 or ${installableAdapters.length + 1} for all): `,
			);
		}

		rl.close();

		// Install commands
		await installCommands(
			installLevel,
			selectedAgents,
			projectRoot,
			canonicalCommandPath,
		);
	} catch (error: unknown) {
		rl.close();
		throw error;
	}
}

async function installCommands(
	level: InstallLevel,
	agentNames: string[],
	projectRoot: string,
	canonicalCommandPath: string,
): Promise<void> {
	if (level === "none" || agentNames.length === 0) {
		return;
	}

	console.log();
	const allAdapters = getAllAdapters();

	for (const agentName of agentNames) {
		const adapter = allAdapters.find((a) => a.name === agentName);
		if (!adapter) continue;

		let commandDir: string | null;
		let isUserLevel: boolean;

		if (level === "project") {
			commandDir = adapter.getProjectCommandDir();
			isUserLevel = false;
			if (commandDir) {
				commandDir = path.join(projectRoot, commandDir);
			}
		} else {
			commandDir = adapter.getUserCommandDir();
			isUserLevel = true;
		}

		if (!commandDir) {
			// This shouldn't happen if we filtered correctly, but good safety check
			continue;
		}

		const commandFileName = `gauntlet${adapter.getCommandExtension()}`;
		const commandFilePath = path.join(commandDir, commandFileName);

		try {
			// Ensure command directory exists
			await fs.mkdir(commandDir, { recursive: true });

			// Check if file already exists
			if (await exists(commandFilePath)) {
				const relPath = isUserLevel
					? commandFilePath
					: path.relative(projectRoot, commandFilePath);
				console.log(
					chalk.dim(`  ${adapter.name}: ${relPath} already exists, skipping`),
				);
				continue;
			}

			// For project-level with symlink support, create symlink
			// For user-level or adapters that need transformation, write the file
			if (!isUserLevel && adapter.canUseSymlink()) {
				// Calculate relative path from command dir to canonical file
				const relativePath = path.relative(commandDir, canonicalCommandPath);
				await fs.symlink(relativePath, commandFilePath);
				const relPath = path.relative(projectRoot, commandFilePath);
				console.log(
					chalk.green(
						`Created ${relPath} (symlink to .gauntlet/run_gauntlet.md)`,
					),
				);
			} else {
				// Transform and write the command file
				const transformedContent = adapter.transformCommand(
					GAUNTLET_COMMAND_CONTENT,
				);
				await fs.writeFile(commandFilePath, transformedContent);
				const relPath = isUserLevel
					? commandFilePath
					: path.relative(projectRoot, commandFilePath);
				console.log(chalk.green(`Created ${relPath}`));
			}
		} catch (error: unknown) {
			const err = error as { message?: string };
			console.log(
				chalk.yellow(
					`  ${adapter.name}: Could not create command - ${err.message}`,
				),
			);
		}
	}
}

/**
 * The stop hook configuration for Claude Code.
 */
const STOP_HOOK_CONFIG = {
	hooks: {
		Stop: [
			{
				hooks: [
					{
						type: "command",
						command: "agent-gauntlet stop-hook",
						timeout: 300,
					},
				],
			},
		],
	},
};

/**
 * Check if running in an interactive TTY environment.
 */
function isInteractive(): boolean {
	return Boolean(process.stdin.isTTY);
}

/**
 * Prompt user to install the Claude Code stop hook.
 */
async function promptAndInstallStopHook(projectRoot: string): Promise<void> {
	// Skip in non-interactive mode
	if (!isInteractive()) {
		return;
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const question = (prompt: string): Promise<string> => {
		return new Promise((resolve) => {
			rl.question(prompt, (answer) => {
				resolve(answer?.trim() ?? "");
			});
		});
	};

	try {
		console.log();
		const answer = await question("Install Claude Code stop hook? (y/n): ");

		const shouldInstall =
			answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";

		if (!shouldInstall) {
			rl.close();
			return;
		}

		rl.close();
		await installStopHook(projectRoot);
	} catch (error: unknown) {
		rl.close();
		throw error;
	}
}

/**
 * Install the stop hook configuration to .claude/settings.local.json.
 */
export async function installStopHook(projectRoot: string): Promise<void> {
	const claudeDir = path.join(projectRoot, ".claude");
	const settingsPath = path.join(claudeDir, "settings.local.json");

	// Ensure .claude directory exists
	await fs.mkdir(claudeDir, { recursive: true });

	let existingSettings: Record<string, unknown> = {};

	// Check if settings.local.json already exists
	if (await exists(settingsPath)) {
		try {
			const content = await fs.readFile(settingsPath, "utf-8");
			existingSettings = JSON.parse(content);
		} catch {
			// If parsing fails, start fresh
			existingSettings = {};
		}
	}

	// Merge hooks configuration
	const existingHooks =
		(existingSettings.hooks as Record<string, unknown>) || {};
	const existingStopHooks = Array.isArray(existingHooks.Stop)
		? existingHooks.Stop
		: [];

	// Check if stop hook already exists to avoid duplicates
	const hookExists = existingStopHooks.some((hook: unknown) =>
		(hook as { hooks?: { command?: string }[] })?.hooks?.some?.(
			(h) => h?.command === "agent-gauntlet stop-hook",
		),
	);
	if (hookExists) {
		console.log(chalk.dim("Stop hook already installed"));
		return;
	}

	// Add our stop hook to the existing Stop hooks
	const newStopHooks = [...existingStopHooks, ...STOP_HOOK_CONFIG.hooks.Stop];

	const mergedSettings = {
		...existingSettings,
		hooks: {
			...existingHooks,
			Stop: newStopHooks,
		},
	};

	// Write with pretty formatting
	await fs.writeFile(
		settingsPath,
		`${JSON.stringify(mergedSettings, null, 2)}\n`,
	);

	console.log(
		chalk.green(
			"Stop hook installed - gauntlet will run automatically when agent stops",
		),
	);
}
