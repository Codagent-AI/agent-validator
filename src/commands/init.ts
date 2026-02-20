import { statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import type { Command } from "commander";
import { type CLIAdapter, getAllAdapters } from "../cli-adapters/index.js";
import {
	computeExpectedHookChecksum,
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

// After bundling, __dirname is `dist/` (one level below package root).
// In dev, __dirname is `src/commands/` (two levels below package root).
// Detect context by checking which path actually contains the skills directory.
const SKILLS_SOURCE_DIR = (() => {
	const bundled = path.join(__dirname, "..", "skills");
	const dev = path.join(__dirname, "..", "..", "skills");
	try {
		statSync(bundled);
		return bundled;
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return dev;
		throw err;
	}
})();

const SKILL_ACTIONS = [
	"run",
	"check",
	"push-pr",
	"fix-pr",
	"status",
	"help",
	"setup",
] as const;

const SKILL_DESCRIPTIONS: Record<(typeof SKILL_ACTIONS)[number], string> = {
	run: "Run the verification suite",
	check: "Run checks only (no reviews)",
	"push-pr": "Commit, push, and create a PR",
	"fix-pr": "Fix PR review comments and CI failures",
	status: "Show gauntlet status",
	help: "Diagnose and explain gauntlet behavior",
	setup: "Configure checks and reviews interactively",
};

const CLI_PREFERENCE_ORDER = [
	"codex",
	"claude",
	"cursor",
	"github-copilot",
	"gemini",
];

// Recommended adapter config: https://github.com/pacaplan/agent-gauntlet/blob/main/docs/eval-results.md
type AdapterCfg = {
	allow_tool_use: boolean;
	thinking_budget: string;
	model?: string;
};
const ADAPTER_CONFIG: Record<string, AdapterCfg> = {
	claude: { allow_tool_use: false, thinking_budget: "high" },
	codex: { allow_tool_use: false, thinking_budget: "low" },
	gemini: { allow_tool_use: false, thinking_budget: "low" },
	cursor: { allow_tool_use: false, thinking_budget: "low", model: "codex" },
	"github-copilot": {
		allow_tool_use: false,
		thinking_budget: "low",
		model: "codex",
	},
};

interface InitOptions {
	yes?: boolean;
}

interface HookTarget {
	projectRoot: string;
	variant: "claude" | "cursor";
	kind: "stop" | "start";
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
			const gauntletExists = await exists(targetDir);

			let hookAdapters: CLIAdapter[];
			let instructionCLINames: string[];

			if (gauntletExists) {
				// Re-run: skip Phases 2-4, use all detected adapters
				console.log(
					chalk.dim(".gauntlet/ already exists, skipping scaffolding"),
				);
				hookAdapters = availableAdapters;
				instructionCLINames = detectedNames;
			} else {
				// Phase 2: Dev CLI Selection
				const devCLINames = await promptDevCLIs(detectedNames, skipPrompts);
				hookAdapters = availableAdapters.filter((a) =>
					devCLINames.includes(a.name),
				);

				// Warn about CLIs without hook support
				for (const adapter of hookAdapters) {
					if (!adapter.supportsHooks()) {
						console.log(
							chalk.yellow(
								`  ${adapter.name} doesn't support hooks yet, skipping hook installation`,
							),
						);
					}
				}

				// Phase 3: Review CLI Selection & Config
				const reviewCLINames = await promptReviewCLIs(
					detectedNames,
					skipPrompts,
				);
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

				instructionCLINames = devCLINames;
			}

			// Phase 5: Install External Files (ALWAYS runs)
			await installExternalFiles(projectRoot, hookAdapters, skipPrompts);

			// Add log directory to .gitignore
			await addToGitignore(projectRoot, "gauntlet_logs");

			// Phase 6: Instructions
			printPostInitInstructions(instructionCLINames);
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
}

/**
 * Recursively copy a source directory to a target directory.
 */
async function copyDirRecursive(opts: {
	src: string;
	dest: string;
}): Promise<void> {
	await fs.mkdir(opts.dest, { recursive: true });
	const entries = await fs.readdir(opts.src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(opts.src, entry.name);
		const destPath = path.join(opts.dest, entry.name);
		if (entry.isDirectory()) {
			await copyDirRecursive({ src: srcPath, dest: destPath });
		} else {
			await fs.copyFile(srcPath, destPath);
		}
	}
}

/**
 * Install or update skills using checksum-based comparison.
 * Compares the bundled source directory against the installed target directory.
 */
async function installSkillsWithChecksums(
	projectRoot: string,
	skipPrompts: boolean,
): Promise<void> {
	const skillsDir = path.join(projectRoot, ".claude", "skills");
	for (const action of SKILL_ACTIONS) {
		const dirName = `gauntlet-${action}`;
		const sourceDir = path.join(SKILLS_SOURCE_DIR, dirName);
		const targetDir = path.join(skillsDir, dirName);
		const relativeDir = `${path.relative(projectRoot, targetDir)}/`;

		if (!(await exists(targetDir))) {
			await copyDirRecursive({ src: sourceDir, dest: targetDir });
			console.log(chalk.green(`Created ${relativeDir}`));
			continue;
		}

		const sourceChecksum = await computeSkillChecksum(sourceDir);
		const targetChecksum = await computeSkillChecksum(targetDir);
		if (sourceChecksum === targetChecksum) continue;

		const shouldOverwrite = await promptFileOverwrite(dirName, skipPrompts);
		if (!shouldOverwrite) continue;

		// Clean and re-copy to remove stale files
		await fs.rm(targetDir, { recursive: true, force: true });
		await copyDirRecursive({ src: sourceDir, dest: targetDir });
		console.log(chalk.green(`Updated ${relativeDir}`));
	}
}

/**
 * Install or update hooks for a single adapter + kind using checksum-based comparison.
 */
async function installHookWithChecksums(
	target: HookTarget,
	skipPrompts: boolean,
): Promise<void> {
	const spec = buildHookSpec(target);

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
		if (adapter.name !== "claude" && adapter.name !== "cursor") continue;
		for (const kind of ["stop", "start"] as const) {
			const target: HookTarget = {
				projectRoot,
				variant: adapter.name,
				kind,
			};
			await installHookWithChecksums(target, skipPrompts);
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
				"To complete setup, run /gauntlet-setup in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Gauntlet will run.",
			),
		);
	}
	if (hasNonNative) {
		console.log(
			chalk.bold(
				"To complete setup, reference the setup skill in your CLI: @.claude/skills/gauntlet-setup/SKILL.md. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Gauntlet will run.",
			),
		);
		console.log();
		console.log("Available skills:");
		for (const action of SKILL_ACTIONS) {
			console.log(
				`  @.claude/skills/gauntlet-${action}/SKILL.md — ${SKILL_DESCRIPTIONS[action]}`,
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
		let block = `    ${name}:\n      allow_tool_use: ${c?.allow_tool_use}\n      thinking_budget: ${c?.thinking_budget}`;
		if (c?.model) {
			block += `\n      model: ${c.model}`;
		}
		return block;
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

function buildHookSpec(target: HookTarget): HookInstallSpec {
	const { projectRoot, variant, kind } = target;
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

async function installHookBySpec(target: HookTarget): Promise<void> {
	const spec = buildHookSpec(target);
	await installHookWithLog(spec.config, spec.installedMsg, spec.existsMsg);
}

export async function installStopHook(projectRoot: string): Promise<void> {
	await installHookBySpec({ projectRoot, variant: "claude", kind: "stop" });
}

export async function installCursorStopHook(
	projectRoot: string,
): Promise<void> {
	await installHookBySpec({ projectRoot, variant: "cursor", kind: "stop" });
}

export async function installStartHook(projectRoot: string): Promise<void> {
	await installHookBySpec({ projectRoot, variant: "claude", kind: "start" });
}

export async function installCursorStartHook(
	projectRoot: string,
): Promise<void> {
	await installHookBySpec({ projectRoot, variant: "cursor", kind: "start" });
}
