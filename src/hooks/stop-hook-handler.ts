import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { loadGlobalConfig } from '../config/global.js';
import type { StopHookConfig } from '../config/stop-hook-config.js';
import { resolveStopHookConfig } from '../config/stop-hook-config.js';
import { getCategoryLogger } from '../output/app-logger.js';
import type { GauntletStatus } from '../types/gauntlet-status.js';
import type { DebugLogger } from '../utils/debug-log.js';
import type { StopHookContext, StopHookResult } from './adapters/types.js';
import {
  checkRunInterval,
  hasChangesSinceLastRun,
  hasChangesVsBaseBranch,
  hasFailedRunLogs,
} from './stop-hook-state.js';

interface MinimalConfig {
  log_dir?: string;
  debug_log?: {
    enabled?: boolean;
    max_size_mb?: number;
  };
  base_branch?: string;
}

/**
 * Internal context passed to private handler methods.
 */
interface HandlerCtx {
  logDir: string;
  cwd: string;
  log: ReturnType<typeof getStopHookLogger>;
}

/**
 * Default log directory when config doesn't specify one.
 */
const DEFAULT_LOG_DIR = 'gauntlet_logs';

/**
 * Skill instructions returned as the `reason` field when blocking stop.
 * These are concise directives — the skills contain full workflow logic.
 */
const SKILL_INSTRUCTIONS = {
  validation_required:
    'Changes detected, you must use the `gauntlet-run` skill to validate them now.',
} as const;

/**
 * Read and parse the project config file.
 * Returns undefined if the file doesn't exist or can't be parsed.
 */
async function readProjectConfig(
  projectCwd: string,
): Promise<MinimalConfig | undefined> {
  try {
    const configPath = path.join(projectCwd, '.gauntlet', 'config.yml');
    const content = await fs.readFile(configPath, 'utf-8');
    return YAML.parse(content) as MinimalConfig;
  } catch {
    return undefined;
  }
}

/**
 * Get a logger for stop-hook operations.
 */
function getStopHookLogger() {
  return getCategoryLogger('stop-hook');
}

/**
 * Static status messages for statuses that don't need dynamic context.
 */
const STATUS_MESSAGES: Record<string, string> = {
  passed: '✓ Gauntlet passed — all gates completed successfully.',
  passed_with_warnings:
    '✓ Gauntlet completed — passed with warnings (some issues were skipped).',
  no_applicable_gates:
    '✓ Gauntlet passed — no applicable gates matched current changes.',
  no_changes: '✓ Gauntlet passed — no changes detected.',
  retry_limit_exceeded:
    '⚠ Gauntlet terminated — retry limit exceeded. Run `agent-gauntlet clean` to archive and continue.',
  lock_conflict:
    '⏭ Gauntlet skipped — another gauntlet run is already in progress.',
  failed: '✗ Gauntlet failed — issues must be fixed before stopping.',
  validation_required:
    '✗ Validation required — changes detected that need validation before stopping.',
  no_config: '○ Not a gauntlet project — no .gauntlet/config.yml found.',
  stop_hook_active:
    '↺ Stop hook cycle detected — allowing stop to prevent infinite loop.',
  loop_detected:
    '↺ Loop detected — stop hook blocked 3 times within 60s. Allowing stop to prevent infinite loop.',
  stop_hook_disabled: '',
  invalid_input: '⚠ Invalid hook input — could not parse JSON, allowing stop.',
};

/**
 * Get a human-friendly message for each status code.
 * These messages explain why the stop was approved or blocked.
 */
export function getStatusMessage(
  status: GauntletStatus,
  context?: { intervalMinutes?: number; errorMessage?: string },
): string {
  // Handle statuses that need dynamic context
  if (status === 'interval_not_elapsed') {
    return context?.intervalMinutes
      ? `⏭ Gauntlet skipped — run interval (${context.intervalMinutes} min) not elapsed since last run.`
      : '⏭ Gauntlet skipped — run interval not elapsed since last run.';
  }

  if (status === 'error') {
    return context?.errorMessage
      ? `⚠ Stop hook error — ${context.errorMessage}`
      : '⚠ Stop hook error — unexpected error occurred.';
  }

  // Use static lookup for all other statuses
  return STATUS_MESSAGES[status] ?? `Unknown status: ${status}`;
}

/**
 * Read the log_dir from project config without full validation.
 */
export async function getLogDir(projectCwd: string): Promise<string> {
  const config = await readProjectConfig(projectCwd);
  return config?.log_dir || DEFAULT_LOG_DIR;
}

/**
 * Read the debug_log config from project config without full validation.
 */
export async function getDebugLogConfig(
  projectCwd: string,
): Promise<MinimalConfig['debug_log']> {
  const config = await readProjectConfig(projectCwd);
  return config?.debug_log;
}

/**
 * Get resolved stop hook config with 3-tier precedence.
 */
async function getResolvedStopHookConfig(
  projectCwd: string,
): Promise<StopHookConfig | null> {
  try {
    const configPath = path.join(projectCwd, '.gauntlet', 'config.yml');
    const content = await fs.readFile(configPath, 'utf-8');
    const raw = YAML.parse(content) as { stop_hook?: Record<string, unknown> };
    const projectStopHookConfig = raw?.stop_hook as
      | { enabled?: boolean; run_interval_minutes?: number }
      | undefined;
    const globalConfig = await loadGlobalConfig();
    return resolveStopHookConfig(projectStopHookConfig, globalConfig);
  } catch {
    return null;
  }
}

/**
 * Core stop hook handler that reads state and determines whether to block stop.
 * Protocol-agnostic: works with any adapter that provides a StopHookContext.
 *
 * This handler is stateless — it only READS state (logs, execution state)
 * and returns skill instructions. It never executes gates or polls CI.
 */
export class StopHookHandler {
  private debugLogger?: DebugLogger;
  private logDir?: string;

  constructor(debugLogger?: DebugLogger) {
    this.debugLogger = debugLogger;
  }

  /**
   * Set the debug logger (can be updated after construction).
   */
  setDebugLogger(debugLogger: DebugLogger): void {
    this.debugLogger = debugLogger;
  }

  /**
   * Set the log directory (needed for state reads).
   */
  setLogDir(logDir: string): void {
    this.logDir = logDir;
  }

  /**
   * Read state and determine whether to block the stop.
   * Returns a skill instruction when blocking, or allows the stop.
   */
  async execute(ctx: StopHookContext): Promise<StopHookResult> {
    const logDir = this.logDir;

    if (!logDir) {
      return this.allow('passed');
    }

    const hctx: HandlerCtx = {
      logDir,
      cwd: ctx.cwd,
      log: getStopHookLogger(),
    };

    const config = await getResolvedStopHookConfig(hctx.cwd);

    if (config?.enabled === false) {
      return this.allow('stop_hook_disabled');
    }

    if (await hasFailedRunLogs(logDir)) {
      hctx.log.info(
        'Failed run logs found — blocking with validation_required',
      );
      return this.block(
        'validation_required',
        SKILL_INSTRUCTIONS.validation_required,
      );
    }

    const intervalResult = await this.checkInterval(hctx, config);
    if (intervalResult) return intervalResult;

    const changesResult = await this.checkForChanges(hctx);
    if (changesResult) return changesResult;

    hctx.log.info('All checks passed — allowing stop');
    return this.allow('passed');
  }

  /**
   * Check if the run interval has elapsed.
   * Returns a StopHookResult to allow stop if interval hasn't elapsed, null to continue.
   */
  private async checkInterval(
    hctx: HandlerCtx,
    config: StopHookConfig | null,
  ): Promise<StopHookResult | null> {
    if (!config || config.run_interval_minutes <= 0) return null;
    const intervalElapsed = await checkRunInterval(
      hctx.logDir,
      config.run_interval_minutes,
    );
    if (!intervalElapsed) {
      hctx.log.info(
        `Run interval (${config.run_interval_minutes} min) not elapsed — allowing stop`,
      );
      return this.allow('interval_not_elapsed', {
        intervalMinutes: config.run_interval_minutes,
      });
    }
    return null;
  }

  /**
   * Check for changes since last passing run or vs base branch.
   * Returns a StopHookResult if action is needed, null to continue.
   */
  private async checkForChanges(
    hctx: HandlerCtx,
  ): Promise<StopHookResult | null> {
    const changesResult = await hasChangesSinceLastRun(hctx.logDir);
    if (changesResult === null) {
      const projectConfig = await readProjectConfig(hctx.cwd);
      const rawBranch = projectConfig?.base_branch;
      const baseBranch =
        typeof rawBranch === 'string' && rawBranch.length > 0
          ? rawBranch
          : 'origin/main';
      const hasChanges = await hasChangesVsBaseBranch(hctx.cwd, baseBranch);
      if (hasChanges) {
        hctx.log.info(
          'Changes detected vs base branch (no prior state) — blocking',
        );
        return this.block(
          'validation_required',
          SKILL_INSTRUCTIONS.validation_required,
        );
      }
      hctx.log.info('No changes vs base branch — allowing stop');
      return this.allow('passed');
    }
    if (changesResult) {
      hctx.log.info('Changes detected since last passing run — blocking');
      return this.block(
        'validation_required',
        SKILL_INSTRUCTIONS.validation_required,
      );
    }
    return null;
  }

  /** Create a blocking result */
  private async block(
    status: GauntletStatus,
    reason: string,
  ): Promise<StopHookResult> {
    await this.debugLogger?.logStopHook('block', status);
    return {
      status,
      shouldBlock: true,
      reason,
      message: getStatusMessage(status),
    };
  }

  /** Create an allowing result */
  private async allow(
    status: GauntletStatus,
    context?: { intervalMinutes?: number },
  ): Promise<StopHookResult> {
    await this.debugLogger?.logStopHook('allow', status);
    return {
      status,
      shouldBlock: false,
      message: getStatusMessage(status, context),
      intervalMinutes: context?.intervalMinutes,
    };
  }
}
