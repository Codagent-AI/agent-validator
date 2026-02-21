import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import type { CLIAdapter } from "../cli-adapters/index.js";
import {
	computeExpectedHookChecksum,
	computeHookChecksum,
	isGauntletHookEntry,
} from "./init-checksums.js";
import { promptHookOverwrite } from "./init-prompts.js";
import { exists } from "./shared.js";

export interface HookTarget {
	projectRoot: string;
	variant: "claude" | "cursor";
	kind: "stop" | "start";
}

/** Check whether a command string already exists in a hook entries array. */
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
 * given hookKey, deduplicate, and write back.
 */
export async function mergeHookConfig(opts: {
	filePath: string;
	hookKey: string;
	hookEntry: Record<string, unknown>;
	deduplicateCmd: string;
	wrapInHooksArray: boolean;
	baseConfig?: Record<string, unknown>;
}): Promise<boolean> {
	const { filePath, hookKey, hookEntry, deduplicateCmd, wrapInHooksArray, baseConfig } = opts;

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

	const entryToAdd = wrapInHooksArray ? { hooks: [hookEntry] } : hookEntry;
	const newEntries = [...existingEntries, entryToAdd];

	const merged: Record<string, unknown> = {
		...(baseConfig ?? {}),
		...existing,
		hooks: { ...existingHooks, [hookKey]: newEntries },
	};

	await fs.writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`);
	return true;
}

const START_HOOK_ENTRY = {
	matcher: "startup|resume|clear|compact",
	hooks: [{ type: "command", command: "agent-gauntlet start-hook", async: false }],
} as const;

const CURSOR_START_HOOK_ENTRY = {
	command: "agent-gauntlet start-hook --adapter cursor",
} as const;

const STOP_HOOK_ENTRY = {
	type: "command",
	command: "agent-gauntlet stop-hook",
	timeout: 300,
} as const;

const CURSOR_STOP_HOOK_ENTRY = {
	command: "agent-gauntlet stop-hook",
	loop_limit: 10,
} as const;

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
	let kindLabel: string;
	if (isCursor) kindLabel = kind;
	else if (isStop) kindLabel = "Stop";
	else kindLabel = "Start";
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

/** Install or update hooks for a single adapter + kind using checksum-based comparison. */
export async function installHookWithChecksums(
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

	if (gauntletEntries.length === 0) {
		await installHookWithLog(spec.config, spec.installedMsg, spec.existsMsg);
		return;
	}

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

	const shouldOverwrite = await promptHookOverwrite(spec.config.filePath, skipPrompts);
	if (!shouldOverwrite) {
		console.log(chalk.dim(spec.existsMsg));
		return;
	}

	const nonGauntletEntries = existingEntries.filter((e) => !isGauntletHookEntry(e));
	const entryToAdd = spec.config.wrapInHooksArray
		? { hooks: [spec.config.hookEntry] }
		: spec.config.hookEntry;
	const newEntries = [...nonGauntletEntries, entryToAdd];

	const merged: Record<string, unknown> = {
		...(spec.config.baseConfig ?? {}),
		...existingConfig,
		hooks: { ...existingHooks, [spec.config.hookKey]: newEntries },
	};
	await fs.mkdir(path.dirname(spec.config.filePath), { recursive: true });
	await fs.writeFile(spec.config.filePath, `${JSON.stringify(merged, null, 2)}\n`);
	console.log(chalk.green(spec.installedMsg));
}

async function installHookBySpec(target: HookTarget): Promise<void> {
	const spec = buildHookSpec(target);
	await installHookWithLog(spec.config, spec.installedMsg, spec.existsMsg);
}

export async function installStopHook(projectRoot: string): Promise<void> {
	await installHookBySpec({ projectRoot, variant: "claude", kind: "stop" });
}

export async function installCursorStopHook(projectRoot: string): Promise<void> {
	await installHookBySpec({ projectRoot, variant: "cursor", kind: "stop" });
}

export async function installStartHook(projectRoot: string): Promise<void> {
	await installHookBySpec({ projectRoot, variant: "claude", kind: "start" });
}

export async function installCursorStartHook(projectRoot: string): Promise<void> {
	await installHookBySpec({ projectRoot, variant: "cursor", kind: "start" });
}

/** Install hooks for all adapters that support them. */
export async function installHooksForAdapters(
	projectRoot: string,
	devAdapters: CLIAdapter[],
	skipPrompts: boolean,
): Promise<void> {
	for (const adapter of devAdapters) {
		if (!adapter.supportsHooks()) continue;
		if (adapter.name !== "claude" && adapter.name !== "cursor") continue;
		for (const kind of ["stop", "start"] as const) {
			const target: HookTarget = { projectRoot, variant: adapter.name, kind };
			await installHookWithChecksums(target, skipPrompts);
		}
	}
}
