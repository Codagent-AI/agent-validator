import fs from 'node:fs/promises';
import chalk from 'chalk';
import type { Job } from '../core/job.js';
import type { GateResult } from '../gates/result.js';
import { reconstructHistory } from '../utils/log-parser.js';

/** Map a gate status to its chalk color and label */
function statusStyle(status: string): {
  color: typeof chalk.green;
  label: string;
} {
  if (status === 'pass') return { color: chalk.green, label: 'PASS' };
  if (status === 'fail') return { color: chalk.red, label: 'FAIL' };
  return { color: chalk.magenta, label: 'ERROR' };
}

/** Build the "Log: path" suffix shown for non-pass results */
function logSuffix(logPath: string | undefined): string {
  if (!logPath) return '';
  const prefix = logPath.endsWith('.json') ? 'Review:' : 'Log:';
  return `\n      ${prefix} ${logPath}`;
}

/** Format and print one sub-result line */
function printSubResult(
  jobId: string,
  sub: NonNullable<GateResult['subResults']>[number],
  duration: string,
): void {
  const { color, label } = statusStyle(sub.status);
  const logInfo = sub.status !== 'pass' ? logSuffix(sub.logPath) : '';
  console.error(
    color(
      `[${label}]  ${jobId} ${chalk.dim(sub.nameSuffix)} (${duration}) - ${sub.message}${logInfo}`,
    ),
  );
}

/** Format and print a single (non-split) result line */
function printSingleResult(
  jobId: string,
  result: GateResult,
  duration: string,
): void {
  const { color, label } = statusStyle(result.status);
  const message = result.message ?? '';

  let logInfo = '';
  if (result.status !== 'pass') {
    const logPath = result.logPath || result.logPaths?.[0];
    if (logPath) {
      logInfo = `\n      Log: ${logPath}`;
    }
  }

  if (result.status === 'pass') {
    console.error(color(`[${label}]  ${jobId} (${duration})`));
  } else {
    console.error(
      color(`[${label}]  ${jobId} (${duration}) - ${message}${logInfo}`),
    );
  }
}

const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/** Print iteration history (fixed / skipped items) from log directory */
async function printIterationHistory(
  logDir: string,
  results: GateResult[],
): Promise<void> {
  try {
    const history = await reconstructHistory(logDir);
    printFixedAndSkipped(history);

    const totalFixed = history.reduce(
      (sum, iter) => sum + iter.fixed.length,
      0,
    );
    const totalSkipped = history.reduce(
      (sum, iter) => sum + iter.skipped.length,
      0,
    );
    const totalFailed = countTotalFailed(results);

    console.error(`\n${chalk.bold(SEPARATOR)}`);
    const iterationsText =
      history.length > 1 ? ` after ${history.length} iterations` : '';
    console.error(
      `Total: ${totalFixed} fixed, ${totalSkipped} skipped, ${totalFailed} failed${iterationsText}`,
    );
  } catch (err) {
    console.warn(
      chalk.yellow(`Warning: Failed to reconstruct history: ${err}`),
    );
  }
}

/** Format a label with optional adapter suffix */
function formatJobLabel(jobId: string, adapter?: string): string {
  return adapter ? `${jobId} (${adapter})` : jobId;
}

/** Print each iteration's fixed and skipped entries */
function printFixedAndSkipped(
  history: Awaited<ReturnType<typeof reconstructHistory>>,
): void {
  for (const iter of history) {
    if (iter.fixed.length === 0 && iter.skipped.length === 0) continue;

    console.error(`\nIteration ${iter.iteration}:`);
    for (const f of iter.fixed) {
      console.error(
        chalk.green(
          `  ✓ Fixed: ${formatJobLabel(f.jobId, f.adapter)} - ${f.details}`,
        ),
      );
    }
    printSkippedItems(iter.skipped);
  }
}

/** Print skipped items for a single iteration */
function printSkippedItems(
  skipped: Awaited<ReturnType<typeof reconstructHistory>>[number]['skipped'],
): void {
  for (const s of skipped) {
    console.error(
      chalk.yellow(
        `  ⊘ Skipped: ${formatJobLabel(s.jobId, s.adapter)} - ${s.file}:${s.line} ${s.issue}`,
      ),
    );
    if (s.result) {
      console.error(chalk.dim(`    Reason: ${s.result}`));
    }
  }
}

/** Check if a status represents a failure */
function isFailureStatus(status: string): boolean {
  return status === 'fail' || status === 'error';
}

/** Count failures for a single result (either from subResults or the result itself) */
function countResultFailures(res: GateResult): number {
  if (res.subResults && res.subResults.length > 0) {
    return res.subResults
      .filter((sub) => isFailureStatus(sub.status))
      .reduce((sum, sub) => sum + (sub.errorCount ?? 1), 0);
  }
  return isFailureStatus(res.status) ? (res.errorCount ?? 1) : 0;
}

/** Count total failed items across results, accounting for subResults */
function countTotalFailed(results: GateResult[]): number {
  return results.reduce((total, res) => total + countResultFailures(res), 0);
}

/** Determine the overall status string and color for the summary */
function computeOverallStatus(
  results: GateResult[],
  statusOverride?: string,
): { overallStatus: string; statusColor: typeof chalk.green } {
  if (statusOverride) {
    const color = statusOverride === 'Trusted' ? chalk.green : chalk.red;
    return { overallStatus: statusOverride, statusColor: color };
  }

  const hasError = results.some((r) => r.status === 'error');
  if (hasError) {
    return { overallStatus: 'Error', statusColor: chalk.magenta };
  }

  const hasFail = results.some((r) => r.status === 'fail');
  if (hasFail) {
    return { overallStatus: 'Failed', statusColor: chalk.red };
  }

  const anySkipped = results.some((r) => r.skipped && r.skipped.length > 0);
  if (anySkipped) {
    return {
      overallStatus: 'Passed with warnings',
      statusColor: chalk.yellow,
    };
  }

  return { overallStatus: 'Passed', statusColor: chalk.green };
}

// ── Review log parsers ───────────────────────────────────────────────

/** Parse "--- Parsed Result ---" violations from review logs */
function parseReviewParsedViolations(logContent: string): string[] {
  const details: string[] = [];
  const parsedResultRegex = /---\s*Parsed Result(?:\s+\(([^)]+)\))?\s*---/;
  const match = logContent.match(parsedResultRegex);
  if (!match || match.index === undefined) return details;

  const violationsSection = logContent.substring(match.index);
  const sectionLines = violationsSection.split('\n');

  for (let i = 0; i < sectionLines.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const line = sectionLines[i]!;
    const violationMatch = line.match(/^\d+\.\s+(.+?):(\d+|\?)\s+-\s+(.+)$/);
    if (!violationMatch) continue;

    const file = violationMatch[1];
    const lineNum = violationMatch[2];
    const issue = violationMatch[3];
    details.push(`  ${chalk.cyan(file)}:${chalk.yellow(lineNum)} - ${issue}`);

    if (i + 1 < sectionLines.length) {
      // biome-ignore lint/style/noNonNullAssertion: bounds checked above
      const nextLine = sectionLines[i + 1]!.trim();
      if (nextLine.startsWith('Fix:')) {
        details.push(
          `    ${chalk.dim('Fix:')} ${nextLine.substring(4).trim()}`,
        );
        i++; // Skip the fix line
      }
    }
  }

  return details;
}

/** Parse JSON violation blocks from review logs */
function parseReviewJsonViolations(logContent: string): string[] {
  const details: string[] = [];
  const jsonStart = logContent.indexOf('{');
  const jsonEnd = logContent.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return details;
  }

  try {
    const jsonStr = logContent.substring(jsonStart, jsonEnd + 1);
    const json = JSON.parse(jsonStr);
    if (
      json.status !== 'fail' ||
      !json.violations ||
      !Array.isArray(json.violations)
    ) {
      return details;
    }

    for (const v of json.violations as Array<{
      file?: string;
      line?: number | string;
      issue?: string;
      fix?: string;
    }>) {
      const file = v.file || 'unknown';
      const line = v.line || '?';
      const issue = v.issue || 'Unknown issue';
      details.push(`  ${chalk.cyan(file)}:${chalk.yellow(line)} - ${issue}`);
      if (v.fix) {
        details.push(`    ${chalk.dim('Fix:')} ${v.fix}`);
      }
    }
  } catch {
    // JSON parse failed, fall through
  }

  return details;
}

/** Extract error messages from review logs as a last resort */
function parseReviewErrorFallback(logContent: string): string[] {
  const details: string[] = [];

  const errorIndex = logContent.indexOf('Error:');
  if (errorIndex !== -1) {
    const afterError = logContent.substring(errorIndex + 6).trim();
    // biome-ignore lint/style/noNonNullAssertion: split always has at least one element
    const firstErrorLine = afterError.split('\n')[0]!.trim();
    if (
      firstErrorLine &&
      !firstErrorLine.startsWith('Usage:') &&
      !firstErrorLine.startsWith('Commands:')
    ) {
      details.push(`  ${firstErrorLine}`);
    }
  }

  if (details.length === 0) {
    const resultMatch = logContent.match(
      /Result:\s*error(?:\s*-\s*(.+?))?(?:\n|$)/,
    );
    if (resultMatch?.[1]) {
      details.push(`  ${resultMatch[1]}`);
    }
  }

  return details;
}

// ── Check log parsers ────────────────────────────────────────────────

/** Parse STDERR section from check logs */
function parseCheckStderr(logContent: string): string[] {
  const details: string[] = [];
  const stderrStart = logContent.indexOf('STDERR:');
  if (stderrStart === -1) return details;

  const stderrSection = logContent.substring(stderrStart + 7).trim();
  const stderrLines = stderrSection.split('\n').filter((line) => {
    return (
      line.trim() &&
      !line.includes('STDOUT:') &&
      !line.includes('Command failed:') &&
      !line.includes('Result:')
    );
  });
  if (stderrLines.length > 0) {
    details.push(...stderrLines.slice(0, 10).map((line) => `  ${line.trim()}`));
  }
  return details;
}

/** Parse error messages from check logs as a fallback */
function parseCheckErrorFallback(logContent: string): string[] {
  const details: string[] = [];
  const errorMatch = logContent.match(/Command failed:\s*(.+?)(?:\n|$)/);
  if (errorMatch) {
    details.push(`  ${errorMatch[1]}`);
  } else {
    const resultMatch = logContent.match(
      /Result:\s*(fail|error)\s*-\s*(.+?)(?:\n|$)/,
    );
    if (resultMatch) {
      details.push(`  ${resultMatch[2]}`);
    }
  }
  return details;
}

// ── Main class ───────────────────────────────────────────────────────

export class ConsoleReporter {
  onJobStart(job: Job) {
    console.error(chalk.blue(`[START] ${job.id}`));
  }

  onJobComplete(job: Job, result: GateResult) {
    const duration = `${(result.duration / 1000).toFixed(2)}s`;

    if (result.subResults && result.subResults.length > 0) {
      for (const sub of result.subResults) {
        printSubResult(job.id, sub, duration);
      }
    } else {
      printSingleResult(job.id, result, duration);
    }
  }

  async printSummary(
    results: GateResult[],
    logDir?: string,
    statusOverride?: string,
  ) {
    console.error(`\n${chalk.bold(SEPARATOR)}`);
    console.error(chalk.bold('RESULTS SUMMARY'));
    console.error(chalk.bold(SEPARATOR));

    if (logDir) {
      await printIterationHistory(logDir, results);
    }

    const { overallStatus, statusColor } = computeOverallStatus(
      results,
      statusOverride,
    );
    console.error(statusColor(`Status: ${overallStatus}`));
    console.error(chalk.bold(`${SEPARATOR}\n`));
  }

  /** @internal Public for testing */
  async extractFailureDetails(result: GateResult): Promise<string[]> {
    const logPaths =
      result.logPaths || (result.logPath ? [result.logPath] : []);

    if (logPaths.length === 0) {
      return [result.message ?? 'Unknown error'];
    }

    const allDetails: string[] = [];
    for (const logPath of logPaths) {
      try {
        const logContent = await fs.readFile(logPath, 'utf-8');
        const details = this.parseLogContent(logContent, result.jobId);
        allDetails.push(...details);
      } catch (_error: unknown) {
        allDetails.push(`(Could not read log file: ${logPath})`);
      }
    }

    return allDetails.length > 0
      ? allDetails
      : [result.message ?? 'Unknown error'];
  }

  private parseLogContent(logContent: string, jobId: string): string[] {
    if (jobId.startsWith('review:')) {
      return this.parseReviewLog(logContent);
    }
    return this.parseCheckLog(logContent);
  }

  private parseReviewLog(logContent: string): string[] {
    const parsed = parseReviewParsedViolations(logContent);
    if (parsed.length > 0) return parsed;

    const json = parseReviewJsonViolations(logContent);
    if (json.length > 0) return json;

    const errors = parseReviewErrorFallback(logContent);
    if (errors.length > 0) return errors;

    return ['  (See log file for details)'];
  }

  private parseCheckLog(logContent: string): string[] {
    const stderr = parseCheckStderr(logContent);
    if (stderr.length > 0) return stderr;

    const errors = parseCheckErrorFallback(logContent);
    if (errors.length > 0) return errors;

    return ['  (See log file for details)'];
  }
}
