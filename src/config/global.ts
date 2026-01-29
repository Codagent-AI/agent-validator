import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const GLOBAL_CONFIG_PATH = path.join(
	os.homedir(),
	".config",
	"agent-gauntlet",
	"config.yml",
);

export const debugLogConfigSchema = z.object({
	enabled: z.boolean().default(false),
	max_size_mb: z.number().default(10),
});

export type DebugLogConfig = z.infer<typeof debugLogConfigSchema>;

const globalConfigSchema = z.object({
	stop_hook: z
		.object({
			enabled: z.boolean().default(true),
			run_interval_minutes: z.number().default(5),
		})
		.default({ enabled: true, run_interval_minutes: 5 }),
	debug_log: debugLogConfigSchema.default({ enabled: false, max_size_mb: 10 }),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
	stop_hook: {
		enabled: true,
		run_interval_minutes: 5,
	},
	debug_log: {
		enabled: false,
		max_size_mb: 10,
	},
};

/**
 * Load the global agent-gauntlet configuration.
 * Returns default values if the file doesn't exist or is invalid.
 */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
	try {
		const content = await fs.readFile(GLOBAL_CONFIG_PATH, "utf-8");
		const raw = YAML.parse(content);
		return globalConfigSchema.parse(raw);
	} catch (error) {
		// Check if file doesn't exist (expected case)
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code: string }).code === "ENOENT"
		) {
			return DEFAULT_GLOBAL_CONFIG;
		}

		// File exists but is invalid - log warning and use defaults
		console.error(
			`[gauntlet] Warning: Failed to parse global config at ${GLOBAL_CONFIG_PATH}, using defaults`,
		);
		return DEFAULT_GLOBAL_CONFIG;
	}
}

/**
 * Get the path to the global config file.
 * Useful for debugging or documentation.
 */
export function getGlobalConfigPath(): string {
	return GLOBAL_CONFIG_PATH;
}
