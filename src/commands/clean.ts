import chalk from "chalk";
import type { Command } from "commander";
import { loadGlobalConfig } from "../config/global.js";
import { loadConfig } from "../config/loader.js";
import {
	getDebugLogger,
	initDebugLogger,
	mergeDebugLogConfig,
} from "../utils/debug-log.js";
import { deleteExecutionState } from "../utils/execution-state.js";
import { acquireLock, cleanLogs, releaseLock } from "./shared.js";

export function registerCleanCommand(program: Command): void {
	program
		.command("clean")
		.description("Archive logs and reset execution state")
		.action(async () => {
			let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
			let lockAcquired = false;
			try {
				config = await loadConfig();

				// Initialize debug logger
				const globalConfig = await loadGlobalConfig();
				const debugLogConfig = mergeDebugLogConfig(
					config.project.debug_log,
					globalConfig.debug_log,
				);
				initDebugLogger(config.project.log_dir, debugLogConfig);

				// Acquire lock BEFORE logging - prevents clean from running during active gauntlet run
				await acquireLock(config.project.log_dir);
				lockAcquired = true;

				// Log the command invocation (only after lock acquired)
				const debugLogger = getDebugLogger();
				await debugLogger?.logCommand("clean", []);
				await debugLogger?.logClean("manual", "user_request");

				await cleanLogs(config.project.log_dir);
				await deleteExecutionState(config.project.log_dir);
				await releaseLock(config.project.log_dir);
				console.log(chalk.green("Logs archived successfully."));
			} catch (error: unknown) {
				if (config && lockAcquired) {
					await releaseLock(config.project.log_dir);
				}
				const err = error as { message?: string };
				console.error(chalk.red("Error:"), err.message);
				process.exit(1);
			}
		});
}
