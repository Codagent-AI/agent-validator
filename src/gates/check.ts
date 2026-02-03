import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { LoadedCheckGateConfig } from "../config/types.js";
import { resolveCheckCommand } from "./resolve-check-command.js";
import type { GateResult } from "./result.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class CheckGateExecutor {
	async execute(
		jobId: string,
		config: LoadedCheckGateConfig,
		workingDirectory: string,
		logger: (output: string) => Promise<void>,
		options?: { baseBranch?: string; isRerun?: boolean },
	): Promise<GateResult> {
		const startTime = Date.now();

		const command = resolveCheckCommand(config, options);

		try {
			await logger(
				`[${new Date().toISOString()}] Starting check: ${config.name}\n`,
			);
			await logger(`Executing command: ${command}\n`);
			await logger(`Working directory: ${workingDirectory}\n\n`);

			const { stdout, stderr } = await execAsync(command, {
				cwd: workingDirectory,
				timeout: config.timeout ? config.timeout * 1000 : undefined,
				maxBuffer: MAX_BUFFER_BYTES,
			});

			if (stdout) await logger(stdout);
			if (stderr) await logger(`\nSTDERR:\n${stderr}`);

			const result: GateResult = {
				jobId,
				status: "pass",
				duration: Date.now() - startTime,
				message: "Command exited with code 0",
			};

			await logger(`Result: ${result.status} - ${result.message}\n`);
			return result;
		} catch (error: unknown) {
			const err = error as {
				stdout?: string;
				stderr?: string;
				message?: string;
				signal?: string;
				code?: number;
			};
			if (err.stdout) await logger(err.stdout);
			if (err.stderr) await logger(`\nSTDERR:\n${err.stderr}`);

			await logger(`\nCommand failed: ${err.message}`);

			// If it's a timeout
			if (err.signal === "SIGTERM" && config.timeout) {
				const result: GateResult = {
					jobId,
					status: "fail",
					duration: Date.now() - startTime,
					message: `Timed out after ${config.timeout}s`,
					fixInstructions: config.fixInstructionsContent,
					fixWithSkill: config.fixWithSkill,
				};
				await logger(`Result: ${result.status} - ${result.message}\n`);
				await this.logFixInfo(config, logger);
				return result;
			}

			// If it's a non-zero exit code
			if (typeof err.code === "number") {
				const result: GateResult = {
					jobId,
					status: "fail",
					duration: Date.now() - startTime,
					message: `Exited with code ${err.code}`,
					fixInstructions: config.fixInstructionsContent,
					fixWithSkill: config.fixWithSkill,
				};
				await logger(`Result: ${result.status} - ${result.message}\n`);
				await this.logFixInfo(config, logger);
				return result;
			}

			// Other errors
			const result: GateResult = {
				jobId,
				status: "error",
				duration: Date.now() - startTime,
				message: err.message || "Unknown error",
				fixInstructions: config.fixInstructionsContent,
				fixWithSkill: config.fixWithSkill,
			};
			await logger(`Result: ${result.status} - ${result.message}\n`);
			await this.logFixInfo(config, logger);
			return result;
		}
	}

	private async logFixInfo(
		config: LoadedCheckGateConfig,
		logger: (output: string) => Promise<void>,
	): Promise<void> {
		if (config.fixInstructionsContent) {
			await logger(
				`\n--- Fix Instructions ---\n${config.fixInstructionsContent}\n`,
			);
		}
		if (config.fixWithSkill) {
			await logger(`\n--- Fix Skill: ${config.fixWithSkill} ---\n`);
		}
	}
}
