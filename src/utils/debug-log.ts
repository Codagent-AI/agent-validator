import fs from 'node:fs/promises';
import path from 'node:path';
import type { DebugLogConfig as GlobalDebugLogConfig } from '../config/global.js';
import type { DiffStats } from '../core/diff-stats.js';

const DEBUG_LOG_FILENAME = '.debug.log';
const DEBUG_LOG_BACKUP_FILENAME = '.debug.log.1';

export interface DebugLogConfig {
  enabled: boolean;
  maxSizeMb: number;
}

/**
 * Get the debug log filename constant.
 * Useful for excluding from clean operations.
 */
export function getDebugLogFilename(): string {
  return DEBUG_LOG_FILENAME;
}

/**
 * Get the debug log backup filename constant.
 * Useful for excluding from clean operations.
 */
export function getDebugLogBackupFilename(): string {
  return DEBUG_LOG_BACKUP_FILENAME;
}

/**
 * DebugLogger class for persistent debug logging.
 * Writes to a single, append-only file that survives clean operations.
 */
export class DebugLogger {
  private logPath: string;
  private backupPath: string;
  private maxSizeBytes: number;
  private enabled: boolean;
  private runStartTime: number | undefined;

  constructor(logDir: string, config: DebugLogConfig) {
    this.logPath = path.join(logDir, DEBUG_LOG_FILENAME);
    this.backupPath = path.join(logDir, DEBUG_LOG_BACKUP_FILENAME);
    this.maxSizeBytes = config.maxSizeMb * 1024 * 1024;
    this.enabled = config.enabled;
  }

  /**
   * Check if debug logging is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Log a CLI command invocation.
   */
  async logCommand(command: string, args: string[]): Promise<void> {
    const argsStr = args.length > 0 ? ` ${args.join(' ')}` : '';
    await this.write(`COMMAND ${command}${argsStr}`);
  }

  /**
   * Log the start of a run/check/review command.
   */
  async logRunStart(
    mode: 'full' | 'verification',
    changes: number,
    gates: number,
  ): Promise<void> {
    this.runStartTime = Date.now();
    await this.write(
      `RUN_START mode=${mode} changes=${changes} gates=${gates}`,
    );
  }

  /**
   * Log the start of a run/check/review command with diff statistics.
   */
  async logRunStartWithDiff(
    mode: 'full' | 'verification',
    diffStats: DiffStats,
    gates: number,
  ): Promise<void> {
    this.runStartTime = Date.now();
    const parts = [
      'RUN_START',
      `mode=${mode}`,
      `base_ref=${diffStats.baseRef}`,
      `files_changed=${diffStats.total}`,
      `files_new=${diffStats.newFiles}`,
      `files_modified=${diffStats.modifiedFiles}`,
      `files_deleted=${diffStats.deletedFiles}`,
      `lines_added=${diffStats.linesAdded}`,
      `lines_removed=${diffStats.linesRemoved}`,
      `gates=${gates}`,
    ];
    await this.write(parts.join(' '));
  }

  /**
   * Log the start of preflight checks.
   */
  async logPreflightStart(jobCount: number): Promise<void> {
    await this.write(`PREFLIGHT_START jobs=${jobCount}`);
  }

  /**
   * Log the result of a single preflight check.
   */
  async logPreflightResult(
    _jobId: string,
    _status: 'pass' | 'fail',
    _reason?: string,
  ): Promise<void> {
    // TODO enable at debug level with logtape
    // const reasonStr = reason ? ` reason=${reason}` : "";
    // await this.write(`PREFLIGHT_CHECK ${jobId} status=${status}${reasonStr}`);
  }

  /**
   * Log the end of preflight checks.
   */
  async logPreflightEnd(
    runnable: number,
    failed: number,
    durationMs: number,
  ): Promise<void> {
    await this.write(
      `PREFLIGHT_END runnable=${runnable} failed=${failed} duration=${durationMs}ms`,
    );
  }

  /**
   * Log the result of a gate execution.
   * When `cli` is provided, the adapter name is included in the log entry.
   */
  async logGateResult(
    gateId: string,
    status: string,
    duration: number,
    opts?: { violations?: number; cli?: string },
  ): Promise<void> {
    const durationStr = `${(duration / 1000).toFixed(1)}s`;
    const cliStr = opts?.cli ? ` cli=${opts.cli}` : '';
    const violationsStr =
      opts?.violations !== undefined ? ` violations=${opts.violations}` : '';
    await this.write(
      `GATE_RESULT ${gateId}${cliStr} status=${status} duration=${durationStr}${violationsStr}`,
    );
  }

  /**
   * Log the end of a run/check/review command.
   */
  async logRunEnd(
    status: string,
    fixed: number,
    skipped: number,
    failed: number,
    iterations: number,
  ): Promise<void> {
    const durationStr =
      this.runStartTime !== undefined
        ? ` duration=${((Date.now() - this.runStartTime) / 1000).toFixed(1)}s`
        : '';
    await this.write(
      `RUN_END status=${status} fixed=${fixed} skipped=${skipped} failed=${failed} iterations=${iterations}${durationStr}`,
    );
  }

  /**
   * Log a clean operation.
   */
  async logClean(type: 'auto' | 'manual', reason: string): Promise<void> {
    await this.write(`CLEAN type=${type} reason=${reason}`);
  }

  /**
   * Log an execution state write, showing only changed fields.
   * Skips `last_run_completed_at` since every log line is already timestamped.
   */
  async logStateWrite(changes: Record<string, string>): Promise<void> {
    const parts = Object.entries(changes).map(
      ([key, value]) => `${key}=${value}`,
    );
    await this.write(
      `STATE_WRITE${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`,
    );
  }

  /**
   * Log an execution state deletion.
   */
  async logStateDelete(): Promise<void> {
    await this.write('STATE_DELETE');
  }

  /**
   * Log an adapter health change.
   */
  async logAdapterHealthChange(
    adapter: string,
    healthy: boolean,
    reason?: string,
  ): Promise<void> {
    if (healthy) {
      await this.write(`STATE_ADAPTER_HEALTHY adapter=${adapter}`);
    } else {
      const reasonStr = reason ? ` reason=${reason}` : '';
      await this.write(
        `STATE_ADAPTER_UNHEALTHY adapter=${adapter}${reasonStr}`,
      );
    }
  }

  /**
   * Log a telemetry summary line from an adapter.
   * Persists the summary (e.g. "[otel] cost=$0.12 in=5 out=100")
   * so it survives log cleaning for longitudinal analysis.
   */
  async logTelemetry(entry: {
    adapter: string;
    summary: string;
  }): Promise<void> {
    await this.write(`TELEMETRY adapter=${entry.adapter} ${entry.summary}`);
  }

  /**
   * Write a log entry with timestamp.
   */
  private async write(message: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const entry = `[${timestamp}] ${message}\n`;

    try {
      // Check if rotation is needed before writing
      await this.rotateIfNeeded();

      // Ensure directory exists
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });

      // Append the entry
      await fs.appendFile(this.logPath, entry, 'utf-8');
    } catch {
      // Silently fail - debug logging should never break the application
    }
  }

  /**
   * Rotate the log file if it exceeds the size limit.
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stat = await fs.stat(this.logPath);
      if (stat.size >= this.maxSizeBytes) {
        // Delete the backup if it exists
        try {
          await fs.rm(this.backupPath, { force: true });
        } catch {
          // Ignore
        }

        // Rename current log to backup
        await fs.rename(this.logPath, this.backupPath);
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }
}

/**
 * Merge project and global debug log configs.
 * Project config overrides global config.
 * If neither specifies enabled, debug logging is disabled.
 */
export function mergeDebugLogConfig(
  projectConfig?: { enabled?: boolean; max_size_mb?: number },
  globalConfig?: GlobalDebugLogConfig,
): DebugLogConfig {
  // Default values
  let enabled = false;
  let maxSizeMb = 10;

  // Apply global config if present
  if (globalConfig) {
    enabled = globalConfig.enabled;
    maxSizeMb = globalConfig.max_size_mb;
  }

  // Apply project config if present (overrides global)
  if (projectConfig !== undefined) {
    if (projectConfig.enabled !== undefined) {
      enabled = projectConfig.enabled;
    }
    if (projectConfig.max_size_mb !== undefined) {
      maxSizeMb = projectConfig.max_size_mb;
    }
  }

  return {
    enabled,
    maxSizeMb,
  };
}

// Singleton instance for global access
let debugLoggerInstance: DebugLogger | null = null;

/**
 * Initialize the global debug logger.
 * Should be called early in command execution.
 */
export function initDebugLogger(logDir: string, config: DebugLogConfig): void {
  debugLoggerInstance = new DebugLogger(logDir, config);
}

/**
 * Get the global debug logger instance.
 * Returns null if not initialized.
 */
export function getDebugLogger(): DebugLogger | null {
  return debugLoggerInstance;
}

/**
 * Reset the global debug logger (for testing).
 */
export function resetDebugLogger(): void {
  debugLoggerInstance = null;
}
