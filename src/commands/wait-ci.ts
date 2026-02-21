import { spawn } from 'node:child_process';
import type { Command } from 'commander';

/**
 * Output structure from wait-ci command.
 */
export interface WaitCIResult {
  ci_status: 'passed' | 'failed' | 'pending' | 'error';
  pr_number?: number;
  pr_url?: string;
  failed_checks: Array<{
    name: string;
    conclusion: string;
    details_url: string;
    /** Actual error output from GitHub Actions logs (if available) */
    log_output?: string;
  }>;
  review_comments: Array<{
    author: string;
    body: string;
    path?: string;
    line?: number;
  }>;
  elapsed_seconds: number;
  error_message?: string;
}

/**
 * Check if gh CLI is available.
 */
async function isGhAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('gh', ['--version'], { stdio: 'pipe' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Run a gh command and return the output.
 */
async function runGh(
  args: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('gh', args, { stdio: 'pipe', cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    proc.on('error', (err) => {
      resolve({ code: 1, stdout: '', stderr: err.message });
    });
  });
}

/**
 * Get PR info for the current branch.
 * Returns null if no PR found or on error.
 */
async function getPRInfo(
  cwd?: string,
): Promise<{ number: number; url: string; headRefName: string } | null> {
  const result = await runGh(
    ['pr', 'view', '--json', 'number,url,headRefName'],
    cwd,
  );
  if (result.code !== 0) {
    return null;
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Get CI check statuses for a PR.
 * Returns null on error, empty array if no checks.
 * Note: gh pr checks uses 'state' (FAILURE/SUCCESS/PENDING) and 'link' (not conclusion/detailsUrl)
 */
async function getChecks(cwd?: string): Promise<Array<{
  name: string;
  state: string;
  link: string;
}> | null> {
  const result = await runGh(
    ['pr', 'checks', '--json', 'name,state,link'],
    cwd,
  );
  const output = result.stdout.trim();
  if (!output) {
    return result.code === 0 ? [] : null;
  }
  try {
    return JSON.parse(output) || [];
  } catch {
    return result.code === 0 ? [] : null;
  }
}

/**
 * Get reviews for a PR.
 * Returns null on error, empty array if no reviews.
 */
async function getReviews(
  prNumber: number,
  cwd?: string,
): Promise<Array<{
  author: { login: string };
  state: string;
  body: string;
}> | null> {
  // Get owner/repo from gh
  const repoResult = await runGh(['repo', 'view', '--json', 'owner,name'], cwd);
  if (repoResult.code !== 0) {
    return null;
  }
  let owner: string;
  let repo: string;
  try {
    const repoInfo = JSON.parse(repoResult.stdout.trim());
    owner = repoInfo.owner.login;
    repo = repoInfo.name;
  } catch {
    return null;
  }

  const result = await runGh(
    [
      'api',
      '--paginate',
      `repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`,
    ],
    cwd,
  );
  if (result.code !== 0) {
    return null;
  }
  try {
    // GitHub API returns 'user' not 'author', so we transform the response
    const rawReviews = JSON.parse(result.stdout.trim()) || [];
    return rawReviews
      .filter(
        (r: { user?: { login: string }; state: string; body: string }) =>
          r.user?.login,
      )
      .map((r: { user: { login: string }; state: string; body: string }) => ({
        author: { login: r.user.login },
        state: r.state,
        body: r.body || '',
      }));
  } catch {
    return null;
  }
}

/**
 * Get the latest review state per author.
 * GitHub API returns all historical reviews, so we need to deduplicate
 * to find each reviewer's current state.
 */
function getLatestReviewsByAuthor(
  reviews: Array<{ author: { login: string }; state: string; body: string }>,
): Array<{ author: { login: string }; state: string; body: string }> {
  const latestByAuthor = new Map<
    string,
    { author: { login: string }; state: string; body: string }
  >();
  // Process in order - later reviews override earlier ones
  for (const review of reviews) {
    latestByAuthor.set(review.author.login, review);
  }
  return Array.from(latestByAuthor.values());
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract GitHub Actions run ID from a check link.
 * Links look like: https://github.com/owner/repo/actions/runs/RUN_ID/job/JOB_ID
 * Returns null if the link is not a GitHub Actions link.
 */
function extractRunId(link: string): string | null {
  const match = link.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * Fetch failed job logs for a GitHub Actions run.
 * Uses `gh run view <run-id> --log-failed` to get actual error output.
 * Returns null if logs can't be fetched.
 */
async function getFailedRunLogs(
  runId: string,
  cwd?: string,
): Promise<string | null> {
  const result = await runGh(['run', 'view', runId, '--log-failed'], cwd);
  if (result.code !== 0 || !result.stdout.trim()) {
    return null;
  }
  // Limit output to avoid huge payloads (keep last ~100 lines)
  const lines = result.stdout.trim().split('\n');
  const maxLines = 100;
  if (lines.length > maxLines) {
    return `... (${lines.length - maxLines} lines truncated)\n${lines.slice(-maxLines).join('\n')}`;
  }
  return result.stdout.trim();
}

/** Group checks by run ID, separating GitHub Actions from external checks */
function groupChecksByRunId(
  failedChecks: Array<{ name: string; state: string; link: string }>,
): Map<string, Array<{ name: string; state: string; link: string }>> {
  const runIdToChecks = new Map<
    string,
    Array<{ name: string; state: string; link: string }>
  >();

  for (const check of failedChecks) {
    const runId = extractRunId(check.link);
    // Use empty string for external checks (no run ID)
    const key = runId ?? '';
    const existing = runIdToChecks.get(key) ?? [];
    existing.push(check);
    runIdToChecks.set(key, existing);
  }

  return runIdToChecks;
}

/**
 * Fetch failure logs for failed checks.
 * Only works for GitHub Actions checks; external checks return null.
 * Fetches logs in parallel for better performance.
 */
async function enrichFailedChecksWithLogs(
  failedChecks: Array<{ name: string; state: string; link: string }>,
  cwd?: string,
): Promise<
  Array<{ name: string; state: string; link: string; log_output?: string }>
> {
  const runIdToChecks = groupChecksByRunId(failedChecks);

  // Fetch logs in parallel for all unique run IDs
  const entries = Array.from(runIdToChecks.entries());
  const logResults = await Promise.all(
    entries.map(([runId]) =>
      runId ? getFailedRunLogs(runId, cwd) : Promise.resolve(null),
    ),
  );

  // Build results with fetched logs
  const results: Array<{
    name: string;
    state: string;
    link: string;
    log_output?: string;
  }> = [];

  for (let i = 0; i < entries.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const [, checks] = entries[i]!;
    const logs = logResults[i];
    for (const check of checks) {
      results.push({ ...check, log_output: logs ?? undefined });
    }
  }

  return results;
}

/** Options for creating a WaitCIResult */
interface ResultOptions {
  status: WaitCIResult['ci_status'];
  startTime: number;
  prInfo?: { number: number; url: string };
  errorMessage?: string;
  failedChecks?: Array<{
    name: string;
    state: string;
    link: string;
    log_output?: string;
  }>;
  reviewComments?: Array<{ author: string; body: string }>;
}

/** Create a WaitCIResult with the given options */
function createResult(opts: ResultOptions): WaitCIResult {
  const elapsed = Math.round((Date.now() - opts.startTime) / 1000);
  return {
    ci_status: opts.status,
    pr_number: opts.prInfo?.number,
    pr_url: opts.prInfo?.url,
    failed_checks:
      opts.failedChecks?.map((c) => ({
        name: c.name,
        conclusion: c.state.toLowerCase(),
        details_url: c.link,
        log_output: c.log_output,
      })) || [],
    review_comments: opts.reviewComments || [],
    elapsed_seconds: elapsed,
    error_message: opts.errorMessage,
  };
}

/** Poll outcome from a single CI status check */
interface PollOutcome {
  error?: string;
  noChecksYet?: boolean;
  noChecksConfigured?: boolean;
  shouldFail?: boolean;
  shouldPass?: boolean;
  failedChecks?: Array<{
    name: string;
    state: string;
    link: string;
    log_output?: string;
  }>;
  reviewComments?: Array<{ author: string; body: string }>;
}

/** Poll CI status and reviews once, returning the outcome */
async function pollCIStatus(
  cwd: string | undefined,
  prNumber: number,
  isFirstPoll: boolean,
): Promise<PollOutcome> {
  const checks = await getChecks(cwd);
  const reviews = await getReviews(prNumber, cwd);

  if (checks === null || reviews === null) {
    return { error: 'Failed to fetch CI status or reviews from GitHub' };
  }

  // Handle zero checks case
  if (checks.length === 0) {
    return isFirstPoll ? { noChecksYet: true } : { noChecksConfigured: true };
  }

  // Process checks and reviews
  const latestReviews = getLatestReviewsByAuthor(reviews);
  const failedChecks = checks.filter((c) => c.state === 'FAILURE');
  const blockingReviews = latestReviews.filter(
    (r) => r.state === 'CHANGES_REQUESTED',
  );
  const reviewComments = blockingReviews.map((r) => ({
    author: r.author.login,
    body: r.body || '',
  }));
  const pendingChecks = checks.filter(
    (c) =>
      c.state === 'PENDING' ||
      c.state === 'QUEUED' ||
      c.state === 'IN_PROGRESS',
  );

  const shouldFail = failedChecks.length > 0 || blockingReviews.length > 0;
  const shouldPass = pendingChecks.length === 0;

  return { shouldFail, shouldPass, failedChecks, reviewComments };
}

/**
 * Wait for CI to complete and check for blocking reviews.
 * @param timeoutSeconds Maximum time to wait for CI
 * @param pollIntervalSeconds Time between polls
 * @param cwd Working directory for gh commands (defaults to process.cwd())
 */
export async function waitForCI(
  timeoutSeconds: number,
  pollIntervalSeconds: number,
  cwd?: string,
): Promise<WaitCIResult> {
  const startTime = Date.now();
  let isFirstPoll = true;

  if (!(await isGhAvailable())) {
    return createResult({
      status: 'error',
      startTime,
      errorMessage: 'gh CLI is not installed or not authenticated',
    });
  }

  const prInfo = await getPRInfo(cwd);
  if (!prInfo) {
    return createResult({
      status: 'error',
      startTime,
      errorMessage: 'No PR found for current branch',
    });
  }

  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    const pollOutcome = await pollCIStatus(cwd, prInfo.number, isFirstPoll);
    isFirstPoll = false;

    if (pollOutcome.error) {
      return createResult({
        status: 'error',
        startTime,
        prInfo,
        errorMessage: pollOutcome.error,
      });
    }

    if (pollOutcome.noChecksYet) {
      await sleep(pollIntervalSeconds * 1000);
      continue;
    }

    if (pollOutcome.noChecksConfigured) {
      return createResult({ status: 'passed', startTime, prInfo });
    }

    if (pollOutcome.shouldFail && pollOutcome.failedChecks) {
      // Enrich failed checks with actual log output from GitHub Actions
      const enrichedChecks = await enrichFailedChecksWithLogs(
        pollOutcome.failedChecks,
        cwd,
      );
      return createResult({
        status: 'failed',
        startTime,
        prInfo,
        failedChecks: enrichedChecks,
        reviewComments: pollOutcome.reviewComments,
      });
    }

    if (pollOutcome.shouldPass) {
      return createResult({ status: 'passed', startTime, prInfo });
    }

    await sleep(pollIntervalSeconds * 1000);
  }

  return createResult({ status: 'pending', startTime, prInfo });
}

export function registerWaitCICommand(program: Command): void {
  program
    .command('wait-ci')
    .description(
      'Wait for CI checks to complete and check for blocking reviews',
    )
    .option(
      '--timeout <seconds>',
      'Maximum time to wait for CI (default: 270)',
      '270',
    )
    .option(
      '--poll-interval <seconds>',
      'Time between CI status checks (default: 15)',
      '15',
    )
    .action(async (options) => {
      const timeout = Number.parseInt(options.timeout, 10);
      const pollInterval = Number.parseInt(options.pollInterval, 10);

      if (Number.isNaN(timeout) || timeout <= 0) {
        console.log(
          JSON.stringify({
            ci_status: 'error',
            failed_checks: [],
            review_comments: [],
            elapsed_seconds: 0,
            error_message: 'Invalid timeout value',
          }),
        );
        process.exit(1);
      }

      if (Number.isNaN(pollInterval) || pollInterval <= 0) {
        console.log(
          JSON.stringify({
            ci_status: 'error',
            failed_checks: [],
            review_comments: [],
            elapsed_seconds: 0,
            error_message: 'Invalid poll-interval value',
          }),
        );
        process.exit(1);
      }

      const result = await waitForCI(timeout, pollInterval);
      console.log(JSON.stringify(result));

      // Exit codes: 0=passed, 1=failed/error, 2=pending (timeout)
      if (result.ci_status === 'passed') {
        process.exit(0);
      } else if (result.ci_status === 'pending') {
        process.exit(2);
      } else {
        process.exit(1);
      }
    });
}
