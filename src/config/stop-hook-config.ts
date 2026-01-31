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
export const GAUNTLET_AUTO_FIX_PR = "GAUNTLET_AUTO_FIX_PR";

/**
 * Resolved stop hook configuration.
 */
export interface StopHookConfig {
	enabled: boolean;
	run_interval_minutes: number;
	auto_push_pr: boolean;
	auto_fix_pr: boolean;
}

type ProjectStopHookConfig = z.infer<typeof stopHookConfigSchema> | undefined;

/**
 * Parse a boolean environment variable (accepts "true", "1", "false", "0").
 * Returns undefined for unset or invalid values.
 */
function parseBooleanEnv(envVar: string | undefined): boolean | undefined {
	if (envVar === undefined) return undefined;
	const normalized = envVar.toLowerCase().trim();
	if (normalized === "true" || normalized === "1") return true;
	if (normalized === "false" || normalized === "0") return false;
	return undefined;
}

/**
 * Parse an integer environment variable (accepts non-negative integers only).
 * Returns undefined for unset or invalid values.
 */
function parseIntegerEnv(envVar: string | undefined): number | undefined {
	if (envVar === undefined) return undefined;
	const normalized = envVar.trim();
	const parsed = Number(normalized);
	if (normalized.length > 0 && Number.isInteger(parsed) && parsed >= 0) {
		return parsed;
	}
	return undefined;
}

/**
 * Parse environment variables for stop hook configuration.
 * Returns undefined for fields that are not set or have invalid values.
 */
export function parseStopHookEnvVars(): {
	enabled?: boolean;
	run_interval_minutes?: number;
	auto_push_pr?: boolean;
	auto_fix_pr?: boolean;
} {
	return {
		enabled: parseBooleanEnv(process.env[GAUNTLET_STOP_HOOK_ENABLED]),
		run_interval_minutes: parseIntegerEnv(
			process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES],
		),
		auto_push_pr: parseBooleanEnv(process.env[GAUNTLET_AUTO_PUSH_PR]),
		auto_fix_pr: parseBooleanEnv(process.env[GAUNTLET_AUTO_FIX_PR]),
	};
}

/**
 * Resolve a single config field with 3-tier precedence: env > project > global.
 */
function resolveField<T>(
	envValue: T | undefined,
	projectValue: T | undefined,
	globalValue: T,
): T {
	if (envValue !== undefined) return envValue;
	if (projectValue !== undefined) return projectValue;
	return globalValue;
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
	const globalStop = globalConfig.stop_hook;

	const enabled = resolveField(
		envVars.enabled,
		projectConfig?.enabled,
		globalStop.enabled,
	);
	const run_interval_minutes = resolveField(
		envVars.run_interval_minutes,
		projectConfig?.run_interval_minutes,
		globalStop.run_interval_minutes,
	);
	const auto_push_pr = resolveField(
		envVars.auto_push_pr,
		projectConfig?.auto_push_pr,
		globalStop.auto_push_pr,
	);
	let auto_fix_pr = resolveField(
		envVars.auto_fix_pr,
		projectConfig?.auto_fix_pr,
		globalStop.auto_fix_pr,
	);

	// Validation: auto_fix_pr requires auto_push_pr
	if (auto_fix_pr && !auto_push_pr) {
		console.error(
			"[gauntlet] Warning: auto_fix_pr=true requires auto_push_pr=true. Treating auto_fix_pr as false.",
		);
		auto_fix_pr = false;
	}

	return { enabled, run_interval_minutes, auto_push_pr, auto_fix_pr };
}
