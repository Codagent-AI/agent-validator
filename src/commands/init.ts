import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import type { Command } from "commander";
import { type CLIAdapter, getAllAdapters } from "../cli-adapters/index.js";
import {
	computeExpectedHookChecksum,
	computeExpectedSkillChecksum,
	computeHookChecksum,
	computeSkillChecksum,
	isGauntletHookEntry,
} from "./init-checksums.js";
import {
	promptDevCLIs,
	promptFileOverwrite,
	promptHookOverwrite,
	promptNumReviews,
	promptReviewCLIs,
} from "./init-prompts.js";
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
 * Skill definitions used by installExternalFiles.
 * Each entry maps a skill action name to its content and metadata.
 */
const SKILL_DEFINITIONS = [
	{
		action: "run",
		content: GAUNTLET_RUN_SKILL_CONTENT,
		description: "Run the verification suite",
	},
	{
		action: "check",
		content: GAUNTLET_CHECK_SKILL_CONTENT,
		description: "Run a single check gate",
	},
	{
		action: "push-pr",
		content: PUSH_PR_SKILL_CONTENT,
		description: "Commit, push, and create a PR",
	},
	{
		action: "fix-pr",
		content: FIX_PR_SKILL_CONTENT,
		description: "Fix PR review comments and CI failures",
	},
	{
		action: "status",
		content: GAUNTLET_STATUS_SKILL_CONTENT,
		description: "Show gauntlet status",
	},
	{
		action: "help",
		content: HELP_SKILL_BUNDLE.content,
		references: HELP_SKILL_BUNDLE.references,
		skillsOnly: true,
		description: "Diagnose and explain gauntlet behavior",
	},
	{
		action: "setup",
		content: SETUP_SKILL_CONTENT,
		references: {
			"check-catalog.md": CHECK_CATALOG_REFERENCE,
			"project-structure.md": PROJECT_STRUCTURE_REFERENCE,
		},
		skillsOnly: true,
		description: "Configure checks and reviews interactively",
	},
] as const;

interface InitOptions {
	yes?: boolean;
}

/**
 * Native CLIs that support the /gauntlet-setup skill invocation.
 */
const NATIVE_CLIS = new Set(["claude", "cursor"]);

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description("Initialize .gauntlet configuration")
		.option("-y, --yes", "Skip prompts and use defaults")
		.action(async (options: InitOptions) => {
			const projectRoot = process.cwd();
			const targetDir = path.join(projectRoot, ".gauntlet");
			const skipPrompts = options.yes ?? false;

			// Phase 1: CLI Detection
			console.log("Detecting available CLI agents...");
			const availableAdapters = await detectAvailableCLIs();

			if (availableAdapters.length === 0) {
				printNoCLIsMessage();
				return;
			}

			const detectedNames = availableAdapters.map((a) => a.name);

			// Phase 2: Dev CLI Selection
			const devCLINames = await promptDevCLIs(detectedNames, skipPrompts);
			const devAdapters = availableAdapters.filter((a) =>
				devCLINames.includes(a.name),
			);

			// Warn about CLIs without hook support
			for (const adapter of devAdapters) {
				if (!adapter.supportsHooks()) {
					console.log(
						chalk.yellow(
							`  ${adapter.name} doesn't support hooks yet, skipping hook installation`,
						),
					);
				}
			}

			// Phase 3: Review CLI Selection & Config
			const reviewCLINames = await promptReviewCLIs(detectedNames, skipPrompts);
			const numReviews = await promptNumReviews(
				reviewCLINames.length,
				skipPrompts,
			);
			console.log(
				chalk.cyan(
					"Agent Gauntlet's built-in code quality reviewer will be installed.",
				),
			);

			// Phase 4: Scaffold .gauntlet/
			await scaffoldGauntletDir(
				projectRoot,
				targetDir,
				reviewCLINames,
				numReviews,
			);

			// Phase 5: Install External Files (ALWAYS runs)
			await installExternalFiles(projectRoot, devAdapters, skipPrompts);

			// Add log directory to .gitignore
			await addToGitignore(projectRoot, "gauntlet_logs");

			// Phase 6: Instructions
			printPostInitInstructions(devCLINames);
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

/**
 * Phase 4: Scaffold the .gauntlet/ directory.
 * If .gauntlet/ already exists, skip scaffolding entirely.
 * No early return — Phase 5 always runs after this.
 */
async function scaffoldGauntletDir(
	_projectRoot: string,
	targetDir: string,
	reviewCLINames: string[],
	numReviews: number,
): Promise<void> {
	if (await exists(targetDir)) {
		console.log(chalk.dim(".gauntlet/ already exists, skipping scaffolding"));
		return;
	}

	// Create base directory structure
	await fs.mkdir(targetDir);
	await fs.mkdir(path.join(targetDir, "checks"));
	await fs.mkdir(path.join(targetDir, "reviews"));

	// Generate config.yml
	await writeConfigYml(targetDir, reviewCLINames);

	// Default code review
	await fs.writeFile(
		path.join(targetDir, "reviews", "code-quality.yml"),
		`builtin: code-quality\nnum_reviews: ${numReviews}\n`,
	);
	console.log(chalk.green("Created .gauntlet/reviews/code-quality.yml"));

	// Copy status script bundle
	await copyStatusScript(targetDir);
}

/**
 * Write a skill's SKILL.md and optional reference files into a directory.
 */
async function writeSkillFiles(
	actionDir: string,
	content: string,
	references: Record<string, string> | undefined,
): Promise<void> {
	await fs.mkdir(actionDir, { recursive: true });
	await fs.writeFile(path.join(actionDir, "SKILL.md"), content);
	if (references) {
		const refsDir = path.join(actionDir, "references");
		await fs.mkdir(refsDir, { recursive: true });
		for (const [fileName, fileContent] of Object.entries(references)) {
			await fs.writeFile(path.join(refsDir, fileName), fileContent);
		}
	}
}

/**
 * Install or update skills using checksum-based comparison.
 */
async function installSkillsWithChecksums(
	projectRoot: string,
	skipPrompts: boolean,
): Promise<void> {
	const skillsDir = path.join(projectRoot, ".claude", "skills");
	for (const skill of SKILL_DEFINITIONS) {
		const actionDir = path.join(skillsDir, `gauntlet-${skill.action}`);
		const skillPath = path.join(actionDir, "SKILL.md");
		const references =
			"references" in skill
				? (skill.references as Record<string, string>)
				: undefined;

		if (!(await exists(actionDir))) {
			await writeSkillFiles(actionDir, skill.content, references);
			console.log(
				chalk.green(`Created ${path.relative(projectRoot, skillPath)}`),
			);
			continue;
		}

		const expectedChecksum = computeExpectedSkillChecksum(
			skill.content,
			references,
		);
		const actualChecksum = await computeSkillChecksum(actionDir);
		if (expectedChecksum === actualChecksum) continue;

		const shouldOverwrite = await promptFileOverwrite(
			`gauntlet-${skill.action}`,
			skipPrompts,
		);
		if (!shouldOverwrite) continue;

		// Clean and rewrite to remove stale files
		await fs.rm(actionDir, { recursive: true, force: true });
		await writeSkillFiles(actionDir, skill.content, references);
		console.log(
			chalk.green(`Updated ${path.relative(projectRoot, skillPath)}`),
		);
	}
}

/**
 * Install or update hooks for a single adapter + kind using checksum-based comparison.
 */
async function installHookWithChecksums(
	projectRoot: string,
	variant: "claude" | "cursor",
	kind: "stop" | "start",
	skipPrompts: boolean,
): Promise<void> {
	const spec = buildHookSpec(projectRoot, variant, kind);

	let existingConfig: Record<string, unknown> = {};
	if (await exists(spec.config.filePath)) {
		try {
			existingConfig = JSON.parse(
				await fs.readFile(spec.config.filePath, "utf-8"),
			);
		} catch {
			existingConfig = {};
		}
	}

	const existingHooks = (existingConfig.hooks as Record<string, unknown>) || {};
	const existingEntries = Array.isArray(existingHooks[spec.config.hookKey])
		? (existingHooks[spec.config.hookKey] as Record<string, unknown>[])
		: [];

	const gauntletEntries = existingEntries.filter((e) => isGauntletHookEntry(e));

	// No existing gauntlet entries — install normally
	if (gauntletEntries.length === 0) {
		await installHookWithLog(spec.config, spec.installedMsg, spec.existsMsg);
		return;
	}

	// Build expected entries for comparison
	const expectedEntry = spec.config.wrapInHooksArray
		? { hooks: [spec.config.hookEntry] }
		: spec.config.hookEntry;
	const expectedChecksum = computeExpectedHookChecksum([
		expectedEntry as Record<string, unknown>,
	]);
	const actualChecksum = computeHookChecksum(existingEntries);

	if (expectedChecksum === actualChecksum) {
		console.log(chalk.dim(spec.existsMsg));
		return;
	}

	const shouldOverwrite = await promptHookOverwrite(
		spec.config.filePath,
		skipPrompts,
	);
	if (!shouldOverwrite) {
		console.log(chalk.dim(spec.existsMsg));
		return;
	}

	// Remove old gauntlet entries, then re-add
	const nonGauntletEntries = existingEntries.filter(
		(e) => !isGauntletHookEntry(e),
	);
	const entryToAdd = spec.config.wrapInHooksArray
		? { hooks: [spec.config.hookEntry] }
		: spec.config.hookEntry;
	const newEntries = [...nonGauntletEntries, entryToAdd];

	const merged: Record<string, unknown> = {
		...(spec.config.baseConfig ?? {}),
		...existingConfig,
		hooks: {
			...existingHooks,
			[spec.config.hookKey]: newEntries,
		},
	};
	await fs.mkdir(path.dirname(spec.config.filePath), { recursive: true });
	await fs.writeFile(
		spec.config.filePath,
		`${JSON.stringify(merged, null, 2)}\n`,
	);
	console.log(chalk.green(spec.installedMsg));
}

/**
 * Phase 5: Install external files (skills + hooks).
 * Always runs, even if .gauntlet/ already existed.
 */
async function installExternalFiles(
	projectRoot: string,
	devAdapters: CLIAdapter[],
	skipPrompts: boolean,
): Promise<void> {
	await installSkillsWithChecksums(projectRoot, skipPrompts);

	for (const adapter of devAdapters) {
		if (!adapter.supportsHooks()) continue;
		const variant = adapter.name as "claude" | "cursor";
		for (const kind of ["stop", "start"] as const) {
			await installHookWithChecksums(projectRoot, variant, kind, skipPrompts);
		}
	}
}

/**
 * Phase 6: Print post-init instructions based on detected CLIs.
 */
function printPostInitInstructions(devCLINames: string[]): void {
	const hasNative = devCLINames.some((name) => NATIVE_CLIS.has(name));
	const nonNativeNames = devCLINames.filter((name) => !NATIVE_CLIS.has(name));
	const hasNonNative = nonNativeNames.length > 0;

	console.log();
	if (hasNative) {
		console.log(
			chalk.bold(
				"To complete setup, run /gauntlet-setup in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run.",
			),
		);
	}
	if (hasNonNative) {
		console.log(
			chalk.bold(
				"To complete setup, reference the setup skill in your CLI: @.claude/skills/gauntlet-setup/SKILL.md. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run.",
			),
		);
		console.log();
		console.log("Available skills:");
		for (const s of SKILL_DEFINITIONS) {
			console.log(
				`  @.claude/skills/gauntlet-${s.action}/SKILL.md — ${s.description}`,
			);
		}
	}
}

async function writeConfigYml(
	targetDir: string,
	reviewCLINames: string[],
): Promise<void> {
	const baseBranch = await detectBaseBranch();
	const cliList = reviewCLINames.map((name) => `    - ${name}`).join("\n");
	const adapterSettings = buildAdapterSettingsBlock(reviewCLINames);

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

function buildAdapterSettingsBlock(adapterNames: string[]): string {
	const items = adapterNames.filter((name) => ADAPTER_CONFIG[name]);
	if (items.length === 0) return "";
	const lines = items.map((name) => {
		const c = ADAPTER_CONFIG[name];
		return `    ${name}:\n      allow_tool_use: ${c?.allow_tool_use}\n      thinking_budget: ${c?.thinking_budget}`;
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

interface HookInstallSpec {
	config: Parameters<typeof mergeHookConfig>[0];
	installedMsg: string;
	existsMsg: string;
}

function buildHookSpec(
	projectRoot: string,
	variant: "claude" | "cursor",
	kind: "stop" | "start",
): HookInstallSpec {
	const isCursor = variant === "cursor";
	const isStop = kind === "stop";
	const hookConfigs = {
		"claude-stop": {
			dir: ".claude",
			file: "settings.local.json",
			hookKey: "Stop",
			entry: STOP_HOOK_ENTRY as Record<string, unknown>,
			cmd: "agent-gauntlet stop-hook",
			wrap: true,
		},
		"cursor-stop": {
			dir: ".cursor",
			file: "hooks.json",
			hookKey: "stop",
			entry: CURSOR_STOP_HOOK_ENTRY as Record<string, unknown>,
			cmd: "agent-gauntlet stop-hook",
			wrap: false,
		},
		"claude-start": {
			dir: ".claude",
			file: "settings.local.json",
			hookKey: "SessionStart",
			entry: START_HOOK_ENTRY as Record<string, unknown>,
			cmd: "agent-gauntlet start-hook",
			wrap: false,
		},
		"cursor-start": {
			dir: ".cursor",
			file: "hooks.json",
			hookKey: "sessionStart",
			entry: CURSOR_START_HOOK_ENTRY as Record<string, unknown>,
			cmd: "agent-gauntlet start-hook --adapter cursor",
			wrap: false,
		},
	} as const;

	const key = `${variant}-${kind}` as keyof typeof hookConfigs;
	const cfg = hookConfigs[key];
	const prefix = isCursor ? "Cursor " : "";
	const kindLabel = isCursor ? kind : isStop ? "Stop" : "Start";
	const purpose = isStop
		? "gauntlet will run automatically when agent stops"
		: "agent will be primed with gauntlet instructions at session start";

	return {
		config: {
			filePath: path.join(projectRoot, cfg.dir, cfg.file),
			hookKey: cfg.hookKey,
			hookEntry: cfg.entry,
			deduplicateCmd: cfg.cmd,
			wrapInHooksArray: cfg.wrap,
			...(isCursor ? { baseConfig: { version: 1 } } : {}),
		},
		installedMsg: `${prefix}${kindLabel} hook installed - ${purpose}`,
		existsMsg: `${prefix}${kindLabel} hook already installed`,
	};
}

async function installHookBySpec(
	projectRoot: string,
	variant: "claude" | "cursor",
	kind: "stop" | "start",
): Promise<void> {
	const spec = buildHookSpec(projectRoot, variant, kind);
	await installHookWithLog(spec.config, spec.installedMsg, spec.existsMsg);
}

export async function installStopHook(projectRoot: string): Promise<void> {
	await installHookBySpec(projectRoot, "claude", "stop");
}

export async function installCursorStopHook(
	projectRoot: string,
): Promise<void> {
	await installHookBySpec(projectRoot, "cursor", "stop");
}

export async function installStartHook(projectRoot: string): Promise<void> {
	await installHookBySpec(projectRoot, "claude", "start");
}

export async function installCursorStartHook(
	projectRoot: string,
): Promise<void> {
	await installHookBySpec(projectRoot, "cursor", "start");
}
