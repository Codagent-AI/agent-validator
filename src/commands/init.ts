import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import type { Command } from "commander";
import { type CLIAdapter, getAllAdapters } from "../cli-adapters/index.js";
import { exists } from "./shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSkillTemplate(filename: string): string {
	const templatePath = path.join(__dirname, "skill-templates", filename);
	return readFileSync(templatePath, "utf-8");
}

const CLI_PREFERENCE_ORDER = [
	"codex",
	"claude",
	"cursor",
	"github-copilot",
	"gemini",
];

// Recommended adapter config: https://github.com/pacaplan/agent-gauntlet/blob/main/docs/eval-results.md
type AdapterCfg = { allow_tool_use: boolean; thinking_budget: string };
const ADAPTER_CONFIG: Record<string, AdapterCfg> = {
	claude: { allow_tool_use: false, thinking_budget: "high" },
	codex: { allow_tool_use: false, thinking_budget: "low" },
	gemini: { allow_tool_use: false, thinking_budget: "low" },
};

// --- Skill content templates ---
// These are used for both skills (Claude) and flat commands (other agents).
// The frontmatter fields (name, disable-model-invocation) are only meaningful
// for skills but are harmless in flat command files.

/**
 * Build gauntlet run/check skill content. Shared structure avoids duplication
 * between the "run" and "check" skills.
 */
function buildGauntletSkillContent(mode: "run" | "check"): string {
	const isRun = mode === "run";
	const name = isRun ? "run" : "check";
	const description = isRun
		? "Run the full verification gauntlet. Use this as the final step after completing a coding task — verifies quality, runs checks, and ensures all gates pass. Must be run before committing, pushing, or creating PRs."
		: "Run checks only (no reviews)";
	const command = isRun ? "agent-gauntlet run" : "agent-gauntlet check";
	const heading = isRun
		? "Execute the autonomous verification suite."
		: "Run the gauntlet checks only \u2014 no AI reviews.";
	const disableModelInvocation = isRun ? "false" : "true";

	const frontmatter = `---
name: gauntlet-${name}
description: >-
  ${description}
disable-model-invocation: ${disableModelInvocation}
allowed-tools: Bash
---`;

	// Common prefix: archive old logs, then run the command
	const steps = [
		`1. Run \`agent-gauntlet clean\` to archive any previous log files`,
		`2. Run \`${command}\``,
	];

	if (isRun) {
		steps.push(
			`3. If it fails:
   - Identify the failed gates from the console output.
   - For CHECK failures: Read the \`.log\` file path provided in the output. If the log contains a \`--- Fix Instructions ---\` section, follow those instructions to fix the issue. If it contains a \`--- Fix Skill: <name> ---\` section, invoke that skill.
   - For REVIEW failures: Read the \`.json\` file path provided in the "Review: <path>" output.
4. Address the violations:
   - For REVIEW violations: You MUST update the \`"status"\` and \`"result"\` fields in the provided \`.json\` file for EACH violation.
     - Set \`"status": "fixed"\` and add a brief description to \`"result"\` for issues you fix.
     - Set \`"status": "skipped"\` and add a brief reason to \`"result"\` for issues you skip (based on the trust level).
     - Do NOT modify any other attributes (file, line, issue, priority) in the JSON file.
   - Apply the trust level above when deciding whether to act on AI reviewer feedback.
5. Run \`${command}\` again to verify your fixes. Do NOT run \`agent-gauntlet clean\` between retries. The tool detects existing logs and automatically switches to verification mode.
6. Repeat steps 3-5 until one of the following termination conditions is met:
   - "Status: Passed" appears in the output (logs are automatically archived)
   - "Status: Passed with warnings" appears in the output (remaining issues were skipped)
   - "Status: Retry limit exceeded" appears in the output -> Run \`agent-gauntlet clean\` to archive logs for the session record. Do NOT retry after cleaning.
7. Provide a summary of the session:
   - Issues Fixed: (list key fixes)
   - Issues Skipped: (list skipped items and reasons)
   - Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)`,
		);
	} else {
		steps.push(
			`3. If any checks fail:
   - Read the \`.log\` file path provided in the output for each failed check. If the log contains a \`--- Fix Instructions ---\` section, follow those instructions. If it contains a \`--- Fix Skill: <name> ---\` section, invoke that skill.
   - Fix the issues found.
4. Run \`${command}\` again to verify your fixes. Do NOT run \`agent-gauntlet clean\` between retries.
5. Repeat steps 3-4 until all checks pass or you've made 3 attempts.
6. Provide a summary of the session:
   - Checks Passed: (list)
   - Checks Failed: (list with brief reason)
   - Fixes Applied: (list key fixes)`,
		);
	}

	if (isRun) {
		return `${frontmatter}
<!--
  REVIEW TRUST LEVEL
  Controls how aggressively the agent acts on AI reviewer feedback.
  Change the trust_level value below to one of: high, medium, low

  - high:   Fix all issues unless you strongly disagree or have low confidence the human wants the change.
  - medium: Fix issues you reasonably agree with or believe the human wants fixed. (DEFAULT)
  - low:    Fix only issues you strongly agree with or are confident the human wants fixed.
-->
<!-- trust_level: medium -->

# /gauntlet-${name}
${heading}

**Review trust level: medium** \u2014 Fix issues you reasonably agree with or believe the human wants to be fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.

${steps.join("\n")}
`;
	}

	return `${frontmatter}

# /gauntlet-${name}
${heading}

${steps.join("\n")}
`;
}

const GAUNTLET_RUN_SKILL_CONTENT = buildGauntletSkillContent("run");
const GAUNTLET_CHECK_SKILL_CONTENT = buildGauntletSkillContent("check");

const PUSH_PR_SKILL_CONTENT = readSkillTemplate("push-pr.md");

const FIX_PR_SKILL_CONTENT = readSkillTemplate("fix-pr.md");

const GAUNTLET_STATUS_SKILL_CONTENT = readSkillTemplate("status.md");

const HELP_SKILL_BUNDLE = {
	content: readSkillTemplate("help-skill.md"),
	references: {
		"stop-hook-troubleshooting.md": readSkillTemplate(
			"help-ref-stop-hook-troubleshooting.md",
		),
		"config-troubleshooting.md": readSkillTemplate(
			"help-ref-config-troubleshooting.md",
		),
		"gate-troubleshooting.md": readSkillTemplate(
			"help-ref-gate-troubleshooting.md",
		),
		"lock-troubleshooting.md": readSkillTemplate(
			"help-ref-lock-troubleshooting.md",
		),
		"adapter-troubleshooting.md": readSkillTemplate(
			"help-ref-adapter-troubleshooting.md",
		),
		"ci-pr-troubleshooting.md": readSkillTemplate(
			"help-ref-ci-pr-troubleshooting.md",
		),
	},
};

const SETUP_SKILL_CONTENT = readSkillTemplate("setup-skill.md");

const CHECK_CATALOG_REFERENCE = readSkillTemplate("check-catalog.md");

const PROJECT_STRUCTURE_REFERENCE = readSkillTemplate(
	"setup-ref-project-structure.md",
);

/**
 * Skill definitions used by installCommands.
 * Each entry maps a skill action name to its content and metadata.
 */
const SKILL_DEFINITIONS = [
	{ action: "run", content: GAUNTLET_RUN_SKILL_CONTENT },
	{ action: "check", content: GAUNTLET_CHECK_SKILL_CONTENT },
	{ action: "push-pr", content: PUSH_PR_SKILL_CONTENT },
	{ action: "fix-pr", content: FIX_PR_SKILL_CONTENT },
	{ action: "status", content: GAUNTLET_STATUS_SKILL_CONTENT },
	{
		action: "help",
		content: HELP_SKILL_BUNDLE.content,
		references: HELP_SKILL_BUNDLE.references,
		skillsOnly: true,
	},
	{
		action: "setup",
		content: SETUP_SKILL_CONTENT,
		references: {
			"check-catalog.md": CHECK_CATALOG_REFERENCE,
			"project-structure.md": PROJECT_STRUCTURE_REFERENCE,
		},
		skillsOnly: true,
	},
] as const;

type InstallLevel = "none" | "project" | "user";

interface InitOptions {
	yes?: boolean;
}

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description("Initialize .gauntlet configuration")
		.option("-y, --yes", "Skip prompts and use defaults")
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
				printNoCLIsMessage();
				return;
			}

			// 2. Scaffold .gauntlet directory, config, reviews, skills
			await scaffoldProject({
				projectRoot,
				targetDir,
				availableAdapters,
				skipPrompts: options.yes ?? false,
			});

			// 3. Auto-install hooks for detected CLIs
			if (availableAdapters.some((a) => a.name === "claude")) {
				await installStopHook(projectRoot);
				await installStartHook(projectRoot);
			}
			if (availableAdapters.some((a) => a.name === "cursor")) {
				await installCursorStopHook(projectRoot);
				await installCursorStartHook(projectRoot);
			}

			// 4. Add log directory to .gitignore
			await addToGitignore(projectRoot, "gauntlet_logs");

			// 5. Next-step message
			console.log();
			console.log(
				chalk.bold("Run /gauntlet-setup to configure your checks and reviews"),
			);
		});
}

function printNoCLIsMessage(): void {
	console.log();
	console.log(chalk.red("Error: No CLI agents found. Install at least one:"));
	console.log("  - Claude: https://docs.anthropic.com/en/docs/claude-code");
	console.log("  - Gemini: https://github.com/google-gemini/gemini-cli");
	console.log("  - Codex: https://github.com/openai/codex");
	console.log();
}

interface ScaffoldOptions {
	projectRoot: string;
	targetDir: string;
	availableAdapters: CLIAdapter[];
	skipPrompts: boolean;
}

async function scaffoldProject(options: ScaffoldOptions): Promise<void> {
	const { projectRoot, targetDir, availableAdapters, skipPrompts } = options;

	// Create base directory structure
	await fs.mkdir(targetDir);
	await fs.mkdir(path.join(targetDir, "checks"));
	await fs.mkdir(path.join(targetDir, "reviews"));

	// Build and install skills
	const commands: SkillCommand[] = SKILL_DEFINITIONS.map((skill) => ({
		action: skill.action,
		content: skill.content,
		...("references" in skill ? { references: skill.references } : {}),
		...("skillsOnly" in skill ? { skillsOnly: skill.skillsOnly } : {}),
	}));

	if (skipPrompts) {
		await installCommands({
			level: "project",
			agentNames: ["claude"],
			projectRoot,
			commands,
		});
	} else {
		await promptAndInstallCommands({ projectRoot, commands });
	}

	// Generate config.yml
	await writeConfigYml(targetDir, availableAdapters);

	// Default code review
	await fs.writeFile(
		path.join(targetDir, "reviews", "code-quality.yml"),
		"builtin: code-quality\nnum_reviews: 1\n",
	);
	console.log(chalk.green("Created .gauntlet/reviews/code-quality.yml"));

	// Copy status script bundle
	await copyStatusScript(targetDir);
}

async function writeConfigYml(
	targetDir: string,
	adapters: CLIAdapter[],
): Promise<void> {
	const baseBranch = await detectBaseBranch();
	const sortedAdapters = [...adapters].sort(
		(a, b) =>
			CLI_PREFERENCE_ORDER.indexOf(a.name) -
			CLI_PREFERENCE_ORDER.indexOf(b.name),
	);
	const cliList = sortedAdapters.map((a) => `    - ${a.name}`).join("\n");
	const adapterSettings = buildAdapterSettingsBlock(adapters);

	const content = `# Ordered list of CLI agents to try for reviews
cli:
  default_preference:
${cliList}
${adapterSettings}
# entry_points configured by /gauntlet-setup
entry_points: []

# -------------------------------------------------------------------
# All settings below are optional. Uncomment and change as needed.
# -------------------------------------------------------------------

# Git ref for detecting local changes via git diff (default: origin/main)
# base_branch: ${baseBranch}

# Directory for per-job logs (default: gauntlet_logs)
# log_dir: gauntlet_logs

# Run gates in parallel when possible (default: true)
# allow_parallel: true

# Maximum retry attempts before declaring "Retry limit exceeded" (default: 3)
# max_retries: 3

# Archived session directories to keep during log rotation (default: 3, 0 = disable)
# max_previous_logs: 3

# Priority threshold for filtering new violations during reruns (default: medium)
# Options: critical, high, medium, low
# rerun_new_issue_threshold: medium

# Stop hook — auto-run gauntlet when the agent stops
# Precedence: env vars > project config > global config (~/.config/agent-gauntlet/config.yml)
# Env overrides: GAUNTLET_STOP_HOOK_ENABLED, GAUNTLET_STOP_HOOK_INTERVAL_MINUTES,
#                GAUNTLET_AUTO_PUSH_PR, GAUNTLET_AUTO_FIX_PR
# stop_hook:
#   enabled: false
#   run_interval_minutes: 5       # Minimum minutes between runs (0 = always run)
#   auto_push_pr: false           # Check/create PR after gates pass
#   auto_fix_pr: false            # Wait for CI checks after PR (requires auto_push_pr)

# Debug log — persistent debug logging to .debug.log
# debug_log:
#   enabled: false
#   max_size_mb: 10               # Max size before rotation to .debug.log.1

# Structured logging via LogTape
# logging:
#   level: debug                  # Options: debug, info, warning, error
#   console:
#     enabled: true
#     format: pretty              # Options: pretty, json
#   file:
#     enabled: true
#     format: text                # Options: text, json
`;
	await fs.writeFile(path.join(targetDir, "config.yml"), content);
	console.log(chalk.green("Created .gauntlet/config.yml"));
}

/**
 * Append an entry to .gitignore if it isn't already present.
 */
async function addToGitignore(
	projectRoot: string,
	entry: string,
): Promise<void> {
	const gitignorePath = path.join(projectRoot, ".gitignore");

	let content = "";
	if (await exists(gitignorePath)) {
		content = await fs.readFile(gitignorePath, "utf-8");
		const lines = content.split("\n").map((l) => l.trim());
		if (lines.includes(entry)) {
			return;
		}
	}

	const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
	await fs.appendFile(gitignorePath, `${suffix}${entry}\n`);
	console.log(chalk.green(`Added ${entry} to .gitignore`));
}

function gitSilent(args: string[], opts?: { timeout?: number }): string | null {
	const { execFileSync } = require("node:child_process");
	try {
		return (
			execFileSync("git", args, {
				encoding: "utf-8",
				timeout: opts?.timeout,
				stdio: ["pipe", "pipe", "ignore"],
			}) as string
		).trim();
	} catch {
		return null;
	}
}

async function detectBaseBranch(): Promise<string> {
	// Fetch the remote's default branch from the server and cache it locally
	gitSilent(["remote", "set-head", "origin", "--auto"], { timeout: 5000 });

	// Read the (possibly just-updated) cached remote HEAD
	const ref = gitSilent(["symbolic-ref", "refs/remotes/origin/HEAD"]);
	if (ref) {
		return ref.replace("refs/remotes/", "");
	}

	// Check which common default branches actually exist locally
	for (const candidate of ["origin/main", "origin/master"]) {
		if (gitSilent(["rev-parse", "--verify", candidate]) !== null) {
			return candidate;
		}
	}

	return "origin/main";
}

function buildAdapterSettingsBlock(adapters: CLIAdapter[]): string {
	const items = adapters.filter((a) => ADAPTER_CONFIG[a.name]);
	if (items.length === 0) return "";
	const lines = items.map((a) => {
		const c = ADAPTER_CONFIG[a.name];
		return `    ${a.name}:\n      allow_tool_use: ${c?.allow_tool_use}\n      thinking_budget: ${c?.thinking_budget}`;
	});
	return `  # Recommended settings (see docs/eval-results.md)\n  adapters:\n${lines.join("\n")}\n`;
}

async function detectAvailableCLIs(): Promise<CLIAdapter[]> {
	const allAdapters = [...getAllAdapters()].sort(
		(a, b) =>
			CLI_PREFERENCE_ORDER.indexOf(a.name) -
			CLI_PREFERENCE_ORDER.indexOf(b.name),
	);
	const available: CLIAdapter[] = [];

	for (const adapter of allAdapters) {
		const isAvailable = await adapter.isAvailable();
		if (isAvailable) {
			console.log(chalk.green(`  \u2713 ${adapter.name}`));
			available.push(adapter);
		} else {
			console.log(chalk.dim(`  \u2717 ${adapter.name} (not installed)`));
		}
	}
	return available;
}

/**
 * Copy the status script bundle into .gauntlet/skills/gauntlet/status/scripts/.
 * The script is sourced from the package's src/scripts/status.ts.
 */
async function copyStatusScript(targetDir: string): Promise<void> {
	const statusScriptDir = path.join(
		targetDir,
		"skills",
		"gauntlet",
		"status",
		"scripts",
	);
	const statusScriptPath = path.join(statusScriptDir, "status.ts");
	await fs.mkdir(statusScriptDir, { recursive: true });

	if (await exists(statusScriptPath)) return;

	const bundledScript = path.join(
		path.dirname(new URL(import.meta.url).pathname),
		"..",
		"scripts",
		"status.ts",
	);
	if (await exists(bundledScript)) {
		await fs.copyFile(bundledScript, statusScriptPath);
		console.log(
			chalk.green("Created .gauntlet/skills/gauntlet/status/scripts/status.ts"),
		);
	} else {
		console.log(
			chalk.yellow(
				"Warning: bundled status script not found; /gauntlet-status may fail.",
			),
		);
	}
}

interface PromptAndInstallOptions {
	projectRoot: string;
	commands: SkillCommand[];
}

async function promptAndInstallCommands(
	options: PromptAndInstallOptions,
): Promise<void> {
	const { projectRoot, commands } = options;

	await installCommands({
		level: "project",
		agentNames: ["claude"],
		projectRoot,
		commands,
	});
}

/**
 * A skill/command to be installed.
 */
interface SkillCommand {
	/** The skill action name (e.g., "run", "check", "push-pr"). */
	action: string;
	/** The Markdown content (with YAML frontmatter). */
	content: string;
	/** Optional reference files to install alongside SKILL.md (skills-only). */
	references?: Record<string, string>;
	/** If true, this skill is only installed for skills-capable adapters (not flat commands). */
	skillsOnly?: boolean;
}

interface InstallContext {
	isUserLevel: boolean;
	projectRoot: string;
}

interface InstallCommandsOptions {
	level: InstallLevel;
	agentNames: string[];
	projectRoot: string;
	commands: SkillCommand[];
}

/**
 * Install a single skill for Claude as a SKILL.md in a nested directory.
 */
async function installSkill(
	skillDir: string,
	ctx: InstallContext,
	command: SkillCommand,
): Promise<void> {
	const actionDir = path.join(skillDir, `gauntlet-${command.action}`);
	const skillPath = path.join(actionDir, "SKILL.md");

	await fs.mkdir(actionDir, { recursive: true });

	if (await exists(skillPath)) {
		const relPath = ctx.isUserLevel
			? skillPath
			: path.relative(ctx.projectRoot, skillPath);
		console.log(chalk.dim(`  claude: ${relPath} already exists, skipping`));
		return;
	}

	await fs.writeFile(skillPath, command.content);
	const relPath = ctx.isUserLevel
		? skillPath
		: path.relative(ctx.projectRoot, skillPath);
	console.log(chalk.green(`Created ${relPath}`));

	// Install reference files if present
	if (command.references) {
		const refsDir = path.join(actionDir, "references");
		await fs.mkdir(refsDir, { recursive: true });
		for (const [fileName, fileContent] of Object.entries(command.references)) {
			const refPath = path.join(refsDir, fileName);
			if (await exists(refPath)) continue;
			await fs.writeFile(refPath, fileContent);
			const refRelPath = ctx.isUserLevel
				? refPath
				: path.relative(ctx.projectRoot, refPath);
			console.log(chalk.green(`Created ${refRelPath}`));
		}
	}
}

/**
 * Install a single flat command file for a non-Claude adapter.
 * Uses the "gauntlet" name prefix for non-namespaced agents.
 */
async function installFlatCommand(
	adapter: CLIAdapter,
	commandDir: string,
	ctx: InstallContext,
	command: SkillCommand,
): Promise<void> {
	// Non-Claude agents get flat files named "gauntlet" (for run) or the action name
	const name = command.action === "run" ? "gauntlet" : command.action;
	const fileName = `${name}${adapter.getCommandExtension()}`;
	const filePath = path.join(commandDir, fileName);

	if (await exists(filePath)) {
		const relPath = ctx.isUserLevel
			? filePath
			: path.relative(ctx.projectRoot, filePath);
		console.log(
			chalk.dim(`  ${adapter.name}: ${relPath} already exists, skipping`),
		);
		return;
	}

	const transformedContent = adapter.transformCommand(command.content);
	await fs.writeFile(filePath, transformedContent);
	const relPath = ctx.isUserLevel
		? filePath
		: path.relative(ctx.projectRoot, filePath);
	console.log(chalk.green(`Created ${relPath}`));
}

/**
 * Install skills for a skills-capable adapter (e.g., Claude).
 */
async function installSkillsForAdapter(
	adapter: CLIAdapter,
	skillDir: string,
	ctx: InstallContext,
	commands: SkillCommand[],
): Promise<void> {
	const resolvedSkillDir = ctx.isUserLevel
		? skillDir
		: path.join(ctx.projectRoot, skillDir);
	try {
		for (const command of commands) {
			await installSkill(resolvedSkillDir, ctx, command);
		}
	} catch (error: unknown) {
		const err = error as { message?: string };
		console.log(
			chalk.yellow(
				`  ${adapter.name}: Could not create skill - ${err.message}`,
			),
		);
	}
}

/**
 * Install flat command files for a non-skills adapter.
 */
async function installFlatCommandsForAdapter(
	adapter: CLIAdapter,
	commandDir: string,
	ctx: InstallContext,
	commands: SkillCommand[],
): Promise<void> {
	const resolvedCommandDir = ctx.isUserLevel
		? commandDir
		: path.join(ctx.projectRoot, commandDir);
	try {
		await fs.mkdir(resolvedCommandDir, { recursive: true });
		// Non-Claude agents only get run, push-pr, and fix-pr (not check/status/help)
		const flatCommands = commands.filter(
			(c) => c.action !== "check" && c.action !== "status" && !c.skillsOnly,
		);
		for (const command of flatCommands) {
			await installFlatCommand(adapter, resolvedCommandDir, ctx, command);
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

async function installCommands(options: InstallCommandsOptions): Promise<void> {
	const { level, agentNames, projectRoot, commands } = options;
	if (level === "none" || agentNames.length === 0) return;

	console.log();
	const allAdapters = getAllAdapters();

	const isUserLevel = level === "user";
	const ctx: InstallContext = { isUserLevel, projectRoot };

	for (const agentName of agentNames) {
		const adapter = allAdapters.find((a) => a.name === agentName);
		if (!adapter) continue;

		const skillDir = isUserLevel
			? adapter.getUserSkillDir()
			: adapter.getProjectSkillDir();

		if (skillDir) {
			await installSkillsForAdapter(adapter, skillDir, ctx, commands);
			continue;
		}

		const commandDir = isUserLevel
			? adapter.getUserCommandDir()
			: adapter.getProjectCommandDir();
		if (!commandDir) continue;

		await installFlatCommandsForAdapter(adapter, commandDir, ctx, commands);
	}
}

/**
 * Check whether a command string already exists in a hook entries array.
 * Handles both flat format (hook.command) and nested format (hook.hooks[].command).
 */
function hookHasCommand(
	entries: Record<string, unknown>[],
	cmd: string,
): boolean {
	return entries.some((hook) => {
		if (hook.command === cmd) return true;
		const nested = hook.hooks as { command?: string }[] | undefined;
		return Array.isArray(nested) && nested.some((h) => h.command === cmd);
	});
}

/**
 * Shared helper: read/create a JSON config file, merge a hook entry under the
 * given hookKey, deduplicate, and write back. Returns true if the entry was
 * added, false if it was already present.
 */
export async function mergeHookConfig(opts: {
	filePath: string;
	hookKey: string;
	hookEntry: Record<string, unknown>;
	deduplicateCmd: string;
	wrapInHooksArray: boolean;
	baseConfig?: Record<string, unknown>;
}): Promise<boolean> {
	const {
		filePath,
		hookKey,
		hookEntry,
		deduplicateCmd,
		wrapInHooksArray,
		baseConfig,
	} = opts;

	// Ensure parent directory exists
	await fs.mkdir(path.dirname(filePath), { recursive: true });

	let existing: Record<string, unknown> = {};
	if (await exists(filePath)) {
		try {
			existing = JSON.parse(await fs.readFile(filePath, "utf-8"));
		} catch {
			existing = {};
		}
	}

	const existingHooks = (existing.hooks as Record<string, unknown>) || {};
	const existingEntries = Array.isArray(existingHooks[hookKey])
		? (existingHooks[hookKey] as Record<string, unknown>[])
		: [];

	if (hookHasCommand(existingEntries, deduplicateCmd)) {
		return false;
	}

	// Wrap entry if needed (Claude Code format wraps in { hooks: [...] })
	const entryToAdd = wrapInHooksArray ? { hooks: [hookEntry] } : hookEntry;

	const newEntries = [...existingEntries, entryToAdd];

	const merged: Record<string, unknown> = {
		...(baseConfig ?? {}),
		...existing,
		hooks: {
			...existingHooks,
			[hookKey]: newEntries,
		},
	};

	await fs.writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`);
	return true;
}

/**
 * The start hook configuration for Claude Code.
 */
const START_HOOK_ENTRY = {
	matcher: "startup|resume|clear|compact",
	hooks: [
		{
			type: "command",
			command: "agent-gauntlet start-hook",
			async: false,
		},
	],
} as const;

/**
 * The start hook configuration for Cursor.
 */
const CURSOR_START_HOOK_ENTRY = {
	command: "agent-gauntlet start-hook --adapter cursor",
} as const;

/**
 * The stop hook configuration for Claude Code.
 */
const STOP_HOOK_ENTRY = {
	type: "command",
	command: "agent-gauntlet stop-hook",
	timeout: 300,
} as const;

/**
 * The stop hook configuration for Cursor.
 */
const CURSOR_STOP_HOOK_ENTRY = {
	command: "agent-gauntlet stop-hook",
	loop_limit: 10,
} as const;

/**
 * Install a hook and log the result.
 */
async function installHookWithLog(
	config: Parameters<typeof mergeHookConfig>[0],
	installedMsg: string,
	existsMsg: string,
): Promise<void> {
	const added = await mergeHookConfig(config);
	console.log(added ? chalk.green(installedMsg) : chalk.dim(existsMsg));
}

export async function installStopHook(projectRoot: string): Promise<void> {
	await installHookWithLog(
		{
			filePath: path.join(projectRoot, ".claude", "settings.local.json"),
			hookKey: "Stop",
			hookEntry: STOP_HOOK_ENTRY,
			deduplicateCmd: "agent-gauntlet stop-hook",
			wrapInHooksArray: true,
		},
		"Stop hook installed - gauntlet will run automatically when agent stops",
		"Stop hook already installed",
	);
}

export async function installCursorStopHook(
	projectRoot: string,
): Promise<void> {
	await installHookWithLog(
		{
			filePath: path.join(projectRoot, ".cursor", "hooks.json"),
			hookKey: "stop",
			hookEntry: CURSOR_STOP_HOOK_ENTRY,
			deduplicateCmd: "agent-gauntlet stop-hook",
			wrapInHooksArray: false,
			baseConfig: { version: 1 },
		},
		"Cursor stop hook installed - gauntlet will run automatically when agent stops",
		"Cursor stop hook already installed",
	);
}

export async function installStartHook(projectRoot: string): Promise<void> {
	await installHookWithLog(
		{
			filePath: path.join(projectRoot, ".claude", "settings.local.json"),
			hookKey: "SessionStart",
			hookEntry: START_HOOK_ENTRY,
			deduplicateCmd: "agent-gauntlet start-hook",
			wrapInHooksArray: false,
		},
		"Start hook installed - agent will be primed with gauntlet instructions at session start",
		"Start hook already installed",
	);
}

export async function installCursorStartHook(
	projectRoot: string,
): Promise<void> {
	await installHookWithLog(
		{
			filePath: path.join(projectRoot, ".cursor", "hooks.json"),
			hookKey: "sessionStart",
			hookEntry: CURSOR_START_HOOK_ENTRY,
			deduplicateCmd: "agent-gauntlet start-hook --adapter cursor",
			wrapInHooksArray: false,
			baseConfig: { version: 1 },
		},
		"Cursor start hook installed - agent will be primed with gauntlet instructions at session start",
		"Cursor start hook already installed",
	);
}
