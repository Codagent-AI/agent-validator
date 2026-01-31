import type { z } from "zod";
import type { GlobalConfig } from "./global.js";
import type { stopHookConfigSchema } from "./schema.js";

/**
 * Environment variable names for stop hook configuration.
 */
export const GAUNTLET_STOP_HOOK_ENABLED = "GAUNTLET_STOP_HOOK_ENABLED";
export const GAUNTLET_STOP_HOOK_INTERVAL_MINUTES =
	"GAUNTLET_STOP_HOOK_INTERVAL_MINUTES";
export const GAUNTLET_AUTO_PUSH_PR = "GAUNTLET_AUTO_PUSH_PR";

/**
 * Resolved stop hook configuration.
 */
export interface StopHookConfig {
	enabled: boolean;
	run_interval_minutes: number;
	auto_push_pr: boolean;
}

type ProjectStopHookConfig = z.infer<typeof stopHookConfigSchema> | undefined;

/**
 * Parse environment variables for stop hook configuration.
 * Returns undefined for fields that are not set or have invalid values.
 */
export function parseStopHookEnvVars(): {
	enabled?: boolean;
	run_interval_minutes?: number;
	auto_push_pr?: boolean;
} {
	const result: {
		enabled?: boolean;
		run_interval_minutes?: number;
		auto_push_pr?: boolean;
	} = {};

	// Parse enabled (accepts "true", "1", "false", "0")
	const enabledEnv = process.env[GAUNTLET_STOP_HOOK_ENABLED];
	if (enabledEnv !== undefined) {
		const normalized = enabledEnv.toLowerCase().trim();
		if (normalized === "true" || normalized === "1") {
			result.enabled = true;
		} else if (normalized === "false" || normalized === "0") {
			result.enabled = false;
		}
		// Invalid values are ignored (fall through to next source)
	}

	// Parse auto_push_pr (accepts "true", "1", "false", "0")
	const autoPushPrEnv = process.env[GAUNTLET_AUTO_PUSH_PR];
	if (autoPushPrEnv !== undefined) {
		const normalized = autoPushPrEnv.toLowerCase().trim();
		if (normalized === "true" || normalized === "1") {
			result.auto_push_pr = true;
		} else if (normalized === "false" || normalized === "0") {
			result.auto_push_pr = false;
		}
		// Invalid values are ignored (fall through to next source)
	}

	// Parse interval (accepts non-negative integers only)
	const intervalEnv = process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES];
	if (intervalEnv !== undefined) {
		const normalized = intervalEnv.trim();
		const parsed = Number(normalized);
		if (normalized.length > 0 && Number.isInteger(parsed) && parsed >= 0) {
			result.run_interval_minutes = parsed;
		}
		// Invalid values are ignored (fall through to next source)
	}

	return result;
}

/**
 * Resolve stop hook configuration from three sources with precedence:
 * 1. Environment variables (highest)
 * 2. Project config (.gauntlet/config.yml)
 * 3. Global config (~/.config/agent-gauntlet/config.yml) (lowest)
 *
 * Each field is resolved independently.
 */
export function resolveStopHookConfig(
	projectConfig: ProjectStopHookConfig,
	globalConfig: GlobalConfig,
): StopHookConfig {
	const envVars = parseStopHookEnvVars();

	// Resolve enabled: env > project > global
	let enabled: boolean;
	if (envVars.enabled !== undefined) {
		enabled = envVars.enabled;
	} else if (projectConfig?.enabled !== undefined) {
		enabled = projectConfig.enabled;
	} else {
		enabled = globalConfig.stop_hook.enabled;
	}

	// Resolve run_interval_minutes: env > project > global
	let run_interval_minutes: number;
	if (envVars.run_interval_minutes !== undefined) {
		run_interval_minutes = envVars.run_interval_minutes;
	} else if (projectConfig?.run_interval_minutes !== undefined) {
		run_interval_minutes = projectConfig.run_interval_minutes;
	} else {
		run_interval_minutes = globalConfig.stop_hook.run_interval_minutes;
	}

	// Resolve auto_push_pr: env > project > global
	let auto_push_pr: boolean;
	if (envVars.auto_push_pr !== undefined) {
		auto_push_pr = envVars.auto_push_pr;
	} else if (projectConfig?.auto_push_pr !== undefined) {
		auto_push_pr = projectConfig.auto_push_pr;
	} else {
		auto_push_pr = globalConfig.stop_hook.auto_push_pr;
	}

	return { enabled, run_interval_minutes, auto_push_pr };
}
