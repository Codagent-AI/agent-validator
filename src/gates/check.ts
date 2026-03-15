import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { LoadedCheckGateConfig } from '../config/types.js';
import { MAX_BUFFER_BYTES } from '../constants.js';
import { resolveCheckCommand } from './resolve-check-command.js';
import type { GateResult } from './result.js';

const execAsync = promisify(exec);

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
        status: 'pass',
        duration: Date.now() - startTime,
        message: 'Command exited with code 0',
        command,
        workingDirectory,
      };

      await logger(`Result: ${result.status} - ${result.message}\n`);
      return result;
    } catch (error: unknown) {
      return this.handleExecutionError(
        error,
        jobId,
        command,
        workingDirectory,
        config,
        startTime,
        logger,
      );
    }
  }

  private async handleExecutionError(
    error: unknown,
    jobId: string,
    command: string,
    workingDirectory: string,
    config: LoadedCheckGateConfig,
    startTime: number,
    logger: (output: string) => Promise<void>,
  ): Promise<GateResult> {
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

    const result = this.buildErrorResult(
      err,
      jobId,
      command,
      workingDirectory,
      config,
      startTime,
    );

    await logger(`Result: ${result.status} - ${result.message}\n`);
    await this.logFixInfo(config, logger);
    return result;
  }

  private buildErrorResult(
    err: { signal?: string; code?: number; message?: string },
    jobId: string,
    command: string,
    workingDirectory: string,
    config: LoadedCheckGateConfig,
    startTime: number,
  ): GateResult {
    const base = {
      jobId,
      duration: Date.now() - startTime,
      command,
      workingDirectory,
      fixInstructions: config.fixInstructionsContent,
      fixWithSkill: config.fixWithSkill,
    };

    if (err.signal === 'SIGTERM' && config.timeout) {
      return {
        ...base,
        status: 'fail',
        message: `Timed out after ${config.timeout}s`,
      };
    }
    if (typeof err.code === 'number') {
      return {
        ...base,
        status: 'fail',
        message: `Exited with code ${err.code}`,
      };
    }
    return {
      ...base,
      status: 'error',
      message: err.message || 'Unknown error',
    };
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
