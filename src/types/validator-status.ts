/**
 * All possible outcomes from validator operations.
 */
export type ValidatorStatus =
  // Run outcomes (from executor)
  | 'passed' // All gates passed
  | 'passed_with_warnings' // Some issues were skipped
  | 'no_applicable_gates' // No gates matched current changes
  | 'no_changes' // No changes detected
  | 'failed' // Gates failed, retries remaining
  | 'retry_limit_exceeded' // Max retries reached
  | 'trusted' // Snapshot trusted by reconciliation; no gates ran
  | 'lock_conflict' // Another run in progress
  | 'error' // Unexpected error (includes config errors)
  | 'no_config'; // No config found

export interface RunResult {
  status: ValidatorStatus;
  /** Human-friendly message explaining the outcome */
  message: string;
  /** Number of gates that ran */
  gatesRun?: number;
  /** Number of gates that failed */
  gatesFailed?: number;
  /** Path to latest console log file */
  consoleLogPath?: string;
  /** Error message if status is "error" */
  errorMessage?: string;
  /** Plain-text report for --report flag (written to stdout by caller) */
  reportText?: string;
  /** Individual gate results (available when gates were executed) */
  gateResults?: Array<{
    jobId: string;
    status: 'pass' | 'fail' | 'error';
    logPath?: string;
    logPaths?: string[];
    subResults?: Array<{
      nameSuffix: string;
      status: 'pass' | 'fail' | 'error';
      logPath?: string;
    }>;
  }>;
}

/**
 * Determine if a status indicates successful completion (exit code 0).
 */
export function isSuccessStatus(status: ValidatorStatus): boolean {
  return (
    status === 'passed' ||
    status === 'passed_with_warnings' ||
    status === 'no_applicable_gates' ||
    status === 'no_changes' ||
    status === 'trusted'
  );
}
