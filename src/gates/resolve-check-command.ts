import type { LoadedCheckGateConfig } from "../config/types.js";

/**
 * Resolves which command to execute for a check gate, selecting rerun_command
 * when in rerun mode and performing variable substitution.
 */
export function resolveCheckCommand(
	config: Pick<LoadedCheckGateConfig, "command" | "rerun_command">,
	options?: { baseBranch?: string; isRerun?: boolean },
): string {
	const rawCommand =
		options?.isRerun && config.rerun_command
			? config.rerun_command
			: config.command;
	let result = rawCommand;
	const baseBranch = options?.baseBranch;
	if (baseBranch) {
		result = result.replace(/\$\{BASE_BRANCH\}/g, () => baseBranch);
	}
	return result;
}
