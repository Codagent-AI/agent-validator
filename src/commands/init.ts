import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";
import { type CLIAdapter, getAllAdapters } from "../cli-adapters/index.js";
import { exists } from "./shared.js";

const MAX_PROMPT_ATTEMPTS = 10;

// --- Skill content templates ---
// These are used for both skills (Claude) and flat commands (other agents).
// The frontmatter fields (name, disable-model-invocation) are only meaningful
// for skills but are harmless in flat command files.

const GAUNTLET_RUN_SKILL_CONTENT = `---
name: run
description: Run the full verification gauntlet
disable-model-invocation: true
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

# /gauntlet:run
Execute the autonomous verification suite.

**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.

0. Run \`agent-gauntlet clean\` to archive any previous log files
1. Run \`agent-gauntlet run\`
2. If it fails:
   - Identify the failed gates from the console output.
   - For CHECK failures: Read the \`.log\` file path provided in the output.
   - For REVIEW failures: Read the \`.json\` file path provided in the "Review: <path>" output.
3. Address the violations:
   - For REVIEW violations: You MUST update the \`"status"\` and \`"result"\` fields in the provided \`.json\` file for EACH violation.
     - Set \`"status": "fixed"\` and add a brief description to \`"result"\` for issues you fix.
     - Set \`"status": "skipped"\` and add a brief reason to \`"result"\` for issues you skip (based on the trust level).
     - Do NOT modify any other attributes (file, line, issue, priority) in the JSON file.
   - Apply the trust level above when deciding whether to act on AI reviewer feedback.
4. Run \`agent-gauntlet run\` again to verify your fixes. It will detect existing logs and automatically switch to verification mode.
5. Repeat steps 2-4 until one of the following termination conditions is met:
   - "Status: Passed" appears in the output (logs are automatically archived)
   - "Status: Passed with warnings" appears in the output (remaining issues were skipped)
   - "Status: Retry limit exceeded" appears in the output -> Run \`agent-gauntlet clean\` to archive logs for the session record. Do NOT retry after cleaning.
6. Provide a summary of the session:
   - Issues Fixed: (list key fixes)
   - Issues Skipped: (list skipped items and reasons)
   - Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)
`;

const GAUNTLET_CHECK_SKILL_CONTENT = `---
name: check
description: Run checks only (no reviews)
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet:check
Run the gauntlet checks only — no AI reviews.

1. Run \`agent-gauntlet check\`
2. If any checks fail:
   - Read the \`.log\` file path provided in the output for each failed check.
   - Fix the issues found.
3. Run \`agent-gauntlet check\` again to verify your fixes.
4. Repeat steps 2-3 until all checks pass or you've made 3 attempts.
5. Provide a summary of the session:
   - Checks Passed: (list)
   - Checks Failed: (list with brief reason)
   - Fixes Applied: (list key fixes)
`;

const PUSH_PR_SKILL_CONTENT = `---
name: push-pr
description: Commit changes, push to remote, and create or update a pull request
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet:push-pr
Commit all changes, push to remote, and create or update a pull request for the current branch.

After the PR is created or updated, verify it exists by running \`gh pr view\`.
`;

const FIX_PR_SKILL_CONTENT = `---
name: fix-pr
description: Fix CI failures or address review comments on a pull request
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet:fix-pr
Fix CI failures or address review comments on the current pull request.

1. Check CI status and review comments: \`gh pr checks\` and \`gh pr view --comments\`
2. Fix any failing checks or address reviewer feedback
3. Commit and push your changes
4. After pushing, verify the PR is updated: \`gh pr view\`
`;

const GAUNTLET_STATUS_SKILL_CONTENT = `---
name: status
description: Show a summary of the most recent gauntlet session
disable-model-invocation: false
allowed-tools: Bash, Read
---

# /gauntlet:status
Show a structured summary of the most recent gauntlet session.

Run the bundled status script and present the output:

\`\`\`bash
bun .gauntlet/skills/gauntlet/status/scripts/status.ts
\`\`\`

If the script fails, read its error output and report the issue. Do not attempt to parse the log files manually.
`;

/**
 * Skill definitions used by scaffoldSkills and installCommands.
 * Each entry maps a skill action name to its content and metadata.
 */
const SKILL_DEFINITIONS = [
	{ action: "run", content: GAUNTLET_RUN_SKILL_CONTENT },
	{ action: "check", content: GAUNTLET_CHECK_SKILL_CONTENT },
	{ action: "push-pr", content: PUSH_PR_SKILL_CONTENT },
	{ action: "fix-pr", content: FIX_PR_SKILL_CONTENT },
	{ action: "status", content: GAUNTLET_STATUS_SKILL_CONTENT },
] as const;

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

			// 5. Default code review (YAML config referencing built-in prompt)
			const reviewYamlContent = `builtin: code-quality\nnum_reviews: 2\n`;
			await fs.writeFile(
				path.join(targetDir, "reviews", "code-quality.yml"),
				reviewYamlContent,
			);
			console.log(chalk.green("Created .gauntlet/reviews/code-quality.yml"));

			// Write canonical skill/command files
			const canonicalPaths = await scaffoldSkills(targetDir);

			// Build the commands list from skill definitions and canonical paths
			const commands = SKILL_DEFINITIONS.map((skill) => ({
				action: skill.action,
				content: skill.content,
				canonicalPath: canonicalPaths[skill.action]!,
			}));

			// Handle command installation
			if (options.yes) {
				// Default: install at project level for all selected agents (if they support it)
				const adaptersToInstall = config.selectedAdapters.filter(
					(a) =>
						a.getProjectCommandDir() !== null ||
						a.getProjectSkillDir() !== null,
				);
				if (adaptersToInstall.length > 0) {
					await installCommands({
						level: "project",
						agentNames: adaptersToInstall.map((a) => a.name),
						projectRoot,
						commands,
					});
				}
			} else {
				// Interactive prompts
				await promptAndInstallCommands({
					projectRoot,
					commands,
					availableAdapters,
				});
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
					chosen.push(availableAdapters[num - 1]!);
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

entry_points:
${entryPoints}
`;
}

/**
 * Canonical skill paths keyed by action name.
 * Each value is the absolute path to the SKILL.md file.
 */
type CanonicalSkillPaths = Record<string, string>;

/**
 * Write canonical skill files into .gauntlet/skills/gauntlet/<action>/SKILL.md.
 * Also copies the status script bundle.
 * Returns a map from action name to canonical SKILL.md path.
 */
async function scaffoldSkills(targetDir: string): Promise<CanonicalSkillPaths> {
	const skillsBase = path.join(targetDir, "skills", "gauntlet");
	const paths: CanonicalSkillPaths = {};

	for (const skill of SKILL_DEFINITIONS) {
		const skillDir = path.join(skillsBase, skill.action);
		const skillPath = path.join(skillDir, "SKILL.md");

		await fs.mkdir(skillDir, { recursive: true });

		if (await exists(skillPath)) {
			console.log(
				chalk.dim(
					`.gauntlet/skills/gauntlet/${skill.action}/SKILL.md already exists, preserving existing file`,
				),
			);
		} else {
			await fs.writeFile(skillPath, skill.content);
			console.log(
				chalk.green(
					`Created .gauntlet/skills/gauntlet/${skill.action}/SKILL.md`,
				),
			);
		}

		paths[skill.action] = skillPath;
	}

	// Copy the status script bundle
	const statusScriptDir = path.join(skillsBase, "status", "scripts");
	const statusScriptPath = path.join(statusScriptDir, "status.ts");
	await fs.mkdir(statusScriptDir, { recursive: true });
	if (!(await exists(statusScriptPath))) {
		// Read from the installed package's bundled script
		const bundledScript = path.join(
			path.dirname(new URL(import.meta.url).pathname),
			"..",
			"..",
			".gauntlet",
			"skills",
			"gauntlet",
			"status",
			"scripts",
			"status.ts",
		);
		if (await exists(bundledScript)) {
			await fs.copyFile(bundledScript, statusScriptPath);
			console.log(
				chalk.green(
					"Created .gauntlet/skills/gauntlet/status/scripts/status.ts",
				),
			);
		}
	}

	return paths;
}

interface PromptAndInstallOptions {
	projectRoot: string;
	commands: SkillCommand[];
	availableAdapters: CLIAdapter[];
}

/**
 * Prompt the user to select an install level (none, project, user).
 */
async function promptInstallLevel(
	questionFn: (prompt: string) => Promise<string>,
): Promise<InstallLevel> {
	console.log("Where would you like to install the /gauntlet command?");
	console.log("  1) Don't install commands");
	console.log(
		"  2) Project level (in this repo's .claude/commands, .gemini/commands, etc.)",
	);
	console.log(
		"  3) User level (in ~/.claude/commands, ~/.gemini/commands, etc.)",
	);
	console.log();

	let answer = await questionFn("Select option [1-3]: ");
	let attempts = 0;

	while (true) {
		attempts++;
		if (attempts > MAX_PROMPT_ATTEMPTS)
			throw new Error("Too many invalid attempts");

		if (answer === "1") return "none";
		if (answer === "2") return "project";
		if (answer === "3") return "user";

		console.log(chalk.yellow("Please enter 1, 2, or 3"));
		answer = await questionFn("Select option [1-3]: ");
	}
}

/**
 * Prompt the user to select which agents to install commands for.
 * Returns the selected agent names (deduplicated).
 */
async function promptAgentSelection(
	questionFn: (prompt: string) => Promise<string>,
	installableAdapters: CLIAdapter[],
): Promise<string[]> {
	console.log();
	console.log("Which CLI agents would you like to install the command for?");
	installableAdapters.forEach((adapter, i) => {
		console.log(`  ${i + 1}) ${adapter.name}`);
	});
	console.log(`  ${installableAdapters.length + 1}) All of the above`);
	console.log();

	const promptText = `Select options (comma-separated, e.g., 1,2 or ${installableAdapters.length + 1} for all): `;
	let answer = await questionFn(promptText);
	let attempts = 0;

	while (true) {
		attempts++;
		if (attempts > MAX_PROMPT_ATTEMPTS)
			throw new Error("Too many invalid attempts");

		const selections = answer
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s);

		if (selections.length === 0) {
			console.log(chalk.yellow("Please select at least one option"));
			answer = await questionFn(promptText);
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
				agents.push(installableAdapters[num - 1]!.name);
			}
		}

		if (valid) {
			return [...new Set(agents)];
		}
		answer = await questionFn(promptText);
	}
}

async function promptAndInstallCommands(
	options: PromptAndInstallOptions,
): Promise<void> {
	const { projectRoot, commands, availableAdapters } = options;
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

		const installLevel = await promptInstallLevel(question);

		if (installLevel === "none") {
			console.log(chalk.dim("\nSkipping command installation."));
			rl.close();
			return;
		}

		const installableAdapters =
			installLevel === "project"
				? availableAdapters.filter(
						(a) =>
							a.getProjectCommandDir() !== null ||
							a.getProjectSkillDir() !== null,
					)
				: availableAdapters.filter(
						(a) =>
							a.getUserCommandDir() !== null ||
							a.getUserSkillDir() !== null,
					);

		if (installableAdapters.length === 0) {
			console.log(
				chalk.yellow(
					`No available agents support ${installLevel}-level commands.`,
				),
			);
			rl.close();
			return;
		}

		const selectedAgents = await promptAgentSelection(
			question,
			installableAdapters,
		);

		rl.close();

		await installCommands({
			level: installLevel,
			agentNames: selectedAgents,
			projectRoot,
			commands,
		});
	} catch (error: unknown) {
		rl.close();
		throw error;
	}
}

/**
 * A skill/command to be installed.
 */
interface SkillCommand {
	/** The skill action name (e.g., "run", "check", "push-pr"). */
	action: string;
	/** The Markdown content (with YAML frontmatter). */
	content: string;
	/** Absolute path to the canonical SKILL.md file. */
	canonicalPath: string;
}

interface InstallCommandsOptions {
	level: InstallLevel;
	agentNames: string[];
	projectRoot: string;
	commands: SkillCommand[];
}

/**
 * Install a single skill for Claude as a symlinked SKILL.md in a nested directory.
 * Creates .claude/skills/gauntlet/<action>/SKILL.md -> .gauntlet/skills/gauntlet/<action>/SKILL.md
 */
async function installSkill(
	skillDir: string,
	isUserLevel: boolean,
	projectRoot: string,
	command: SkillCommand,
): Promise<void> {
	const actionDir = path.join(skillDir, "gauntlet", command.action);
	const skillPath = path.join(actionDir, "SKILL.md");

	await fs.mkdir(actionDir, { recursive: true });

	if (await exists(skillPath)) {
		const relPath = isUserLevel
			? skillPath
			: path.relative(projectRoot, skillPath);
		console.log(chalk.dim(`  claude: ${relPath} already exists, skipping`));
		return;
	}

	if (!isUserLevel) {
		// Project-level: create symlink to canonical file
		const relativePath = path.relative(actionDir, command.canonicalPath);
		await fs.symlink(relativePath, skillPath);
		const relPath = path.relative(projectRoot, skillPath);
		const label = `.gauntlet/skills/gauntlet/${command.action}/SKILL.md`;
		console.log(chalk.green(`Created ${relPath} (symlink to ${label})`));
	} else {
		// User-level: copy the content
		await fs.writeFile(skillPath, command.content);
		console.log(chalk.green(`Created ${skillPath}`));
	}
}

/**
 * Install a single flat command file for a non-Claude adapter.
 * Uses the "gauntlet" name prefix for non-namespaced agents.
 */
async function installFlatCommand(
	adapter: CLIAdapter,
	commandDir: string,
	isUserLevel: boolean,
	projectRoot: string,
	command: SkillCommand,
): Promise<void> {
	// Non-Claude agents get flat files named "gauntlet" (for run) or the action name
	const name = command.action === "run" ? "gauntlet" : command.action;
	const fileName = `${name}${adapter.getCommandExtension()}`;
	const filePath = path.join(commandDir, fileName);

	if (await exists(filePath)) {
		const relPath = isUserLevel
			? filePath
			: path.relative(projectRoot, filePath);
		console.log(
			chalk.dim(`  ${adapter.name}: ${relPath} already exists, skipping`),
		);
		return;
	}

	if (!isUserLevel && adapter.canUseSymlink() && command.canonicalPath) {
		const relativePath = path.relative(commandDir, command.canonicalPath);
		await fs.symlink(relativePath, filePath);
		const relPath = path.relative(projectRoot, filePath);
		const label = `.gauntlet/skills/gauntlet/${command.action}/SKILL.md`;
		console.log(chalk.green(`Created ${relPath} (symlink to ${label})`));
	} else {
		const transformedContent = adapter.transformCommand(command.content);
		await fs.writeFile(filePath, transformedContent);
		const relPath = isUserLevel
			? filePath
			: path.relative(projectRoot, filePath);
		console.log(chalk.green(`Created ${relPath}`));
	}
}

async function installCommands(options: InstallCommandsOptions): Promise<void> {
	const { level, agentNames, projectRoot, commands } = options;
	if (level === "none" || agentNames.length === 0) {
		return;
	}

	console.log();
	const allAdapters = getAllAdapters();

	for (const agentName of agentNames) {
		const adapter = allAdapters.find((a) => a.name === agentName);
		if (!adapter) continue;

		const isUserLevel = level === "user";

		// Check if this adapter supports skills (Claude)
		const skillDir = isUserLevel
			? adapter.getUserSkillDir()
			: adapter.getProjectSkillDir();

		if (skillDir) {
			// Skills-capable adapter: install as nested skill directories
			const resolvedSkillDir = isUserLevel
				? skillDir
				: path.join(projectRoot, skillDir);
			try {
				for (const command of commands) {
					await installSkill(
						resolvedSkillDir,
						isUserLevel,
						projectRoot,
						command,
					);
				}
			} catch (error: unknown) {
				const err = error as { message?: string };
				console.log(
					chalk.yellow(
						`  ${adapter.name}: Could not create skill - ${err.message}`,
					),
				);
			}
		} else {
			// Non-skills adapter: install as flat command files
			const commandDir = isUserLevel
				? adapter.getUserCommandDir()
				: adapter.getProjectCommandDir();

			if (!commandDir) continue;

			const resolvedCommandDir = isUserLevel
				? commandDir
				: path.join(projectRoot, commandDir);

			try {
				await fs.mkdir(resolvedCommandDir, { recursive: true });
				// Non-Claude agents only get run, push-pr, and fix-pr (not check/status)
				const flatCommands = commands.filter(
					(c) => c.action !== "check" && c.action !== "status",
				);
				for (const command of flatCommands) {
					await installFlatCommand(
						adapter,
						resolvedCommandDir,
						isUserLevel,
						projectRoot,
						command,
					);
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
