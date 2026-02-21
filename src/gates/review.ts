import {
  type CLIAdapter,
  getAdapter,
  isUsageLimit,
} from '../cli-adapters/index.js';
import type { AdapterConfig } from '../config/types.js';
import { getCategoryLogger } from '../output/app-logger.js';
import type { GateResult, PreviousViolation } from './result.js';
import {
  buildFinalResult,
  emptyDiffResult,
  handleCriticalError,
  incompleteResult,
  noAdaptersResult,
} from './review-agg.js';
import { getDiff } from './review-diff.js';
import {
  applyRerunFiltering,
  buildReviewPrompt,
  evaluateOutput,
  handleReviewOutput,
  handleUsageLimit,
  logDiffStats,
  logInputStats,
} from './review-eval.js';
import {
  applyPassedSlotSkips,
  collectHealthyAdapters,
  createLoggers,
  dispatchReviews,
  generateReviewAssignments,
  handleReviewError,
  handleSkippedSlots,
  type LoggerBundle,
  type LoggerFactory,
  logSkipMessages,
} from './review-helpers.js';
import type {
  EvaluationResult,
  ReviewConfig,
  SingleReviewResult,
} from './review-types.js';
import { REVIEW_ADAPTER_TIMEOUT_MS } from './review-types.js';

export { JSON_SYSTEM_INSTRUCTION } from './review-types.js';

const log = getCategoryLogger('gate', 'review');

export class ReviewGateExecutor {
  async execute(
    jobId: string,
    config: ReviewConfig,
    entryPointPath: string,
    loggerFactory: LoggerFactory,
    baseBranch: string,
    previousFailures?: Map<string, PreviousViolation[]>,
    changeOptions?: {
      commit?: string;
      uncommitted?: boolean;
      fixBase?: string;
    },
    rerunThreshold: 'critical' | 'high' | 'medium' | 'low' = 'high',
    passedSlots?: Map<number, { adapter: string; passIteration: number }>,
    logDir?: string,
    adapterConfigs?: Record<string, AdapterConfig>,
  ): Promise<GateResult> {
    const startTime = Date.now();
    const { mainLogger, getAdapterLogger, logPaths, logPathsSet } =
      createLoggers(loggerFactory);
    try {
      return await this.executeInner(
        jobId,
        config,
        entryPointPath,
        baseBranch,
        mainLogger,
        getAdapterLogger,
        loggerFactory,
        logPaths,
        logPathsSet,
        startTime,
        previousFailures,
        changeOptions,
        rerunThreshold,
        passedSlots,
        logDir,
        adapterConfigs,
      );
    } catch (error: unknown) {
      return handleCriticalError(error, jobId, startTime, logPaths, mainLogger);
    }
  }

  private async executeInner(
    jobId: string,
    config: ReviewConfig,
    entryPointPath: string,
    baseBranch: string,
    mainLogger: (output: string) => Promise<void>,
    getAdapterLogger: LoggerBundle['getAdapterLogger'],
    loggerFactory: LoggerFactory,
    logPaths: string[],
    logPathsSet: Set<string>,
    startTime: number,
    previousFailures?: Map<string, PreviousViolation[]>,
    changeOptions?: {
      commit?: string;
      uncommitted?: boolean;
      fixBase?: string;
    },
    rerunThreshold: 'critical' | 'high' | 'medium' | 'low' = 'high',
    passedSlots?: Map<number, { adapter: string; passIteration: number }>,
    logDir?: string,
    adapterConfigs?: Record<string, AdapterConfig>,
  ): Promise<GateResult> {
    log.debug(`Starting review: ${config.name} | entry=${entryPointPath}`);
    await mainLogger(`Starting review: ${config.name}\n`);
    await mainLogger(`Entry point: ${entryPointPath}\n`);
    await mainLogger(`Base branch: ${baseBranch}\n`);

    const diff = await this.getDiff(entryPointPath, baseBranch, changeOptions);
    logDiffStats(diff, mainLogger);
    if (!diff.trim()) {
      return emptyDiffResult(jobId, startTime, logPaths, mainLogger);
    }

    const preferences = config.cli_preference || [];
    const required = config.num_reviews ?? 1;
    const parallel = config.parallel ?? false;
    const healthyAdapters = await collectHealthyAdapters(
      preferences,
      mainLogger,
      logDir,
    );
    if (healthyAdapters.length === 0) {
      return noAdaptersResult(jobId, startTime, logPaths, mainLogger);
    }
    log.debug(`Healthy adapters: ${healthyAdapters.join(', ')}`);

    const assignments = generateReviewAssignments(required, healthyAdapters);
    await applyPassedSlotSkips(assignments, required, passedSlots, mainLogger);
    await logSkipMessages(assignments, mainLogger);

    return this.dispatchAndCollect(
      jobId,
      config,
      diff,
      assignments,
      required,
      parallel,
      mainLogger,
      getAdapterLogger,
      loggerFactory,
      logPaths,
      logPathsSet,
      startTime,
      previousFailures,
      rerunThreshold,
      logDir,
      adapterConfigs,
    );
  }

  private async dispatchAndCollect(
    jobId: string,
    config: ReviewConfig,
    diff: string,
    assignments: Array<{
      adapter: string;
      reviewIndex: number;
      skip?: boolean;
      skipReason?: string;
    }>,
    required: number,
    parallel: boolean,
    mainLogger: (output: string) => Promise<void>,
    getAdapterLogger: LoggerBundle['getAdapterLogger'],
    loggerFactory: LoggerFactory,
    logPaths: string[],
    logPathsSet: Set<string>,
    startTime: number,
    previousFailures?: Map<string, PreviousViolation[]>,
    rerunThreshold: 'critical' | 'high' | 'medium' | 'low' = 'high',
    logDir?: string,
    adapterConfigs?: Record<string, AdapterConfig>,
  ): Promise<GateResult> {
    const dispatchMsg = `Dispatching ${required} review(s) via round-robin: ${assignments.map((a) => `${a.adapter}@${a.reviewIndex}`).join(', ')}`;
    log.debug(dispatchMsg);
    await mainLogger(`${dispatchMsg}\n`);

    const runningAssignments = assignments.filter((a) => !a.skip);
    const skippedAssignments = assignments.filter((a) => a.skip);
    log.debug(
      `Running: ${runningAssignments.length}, Skipped: ${skippedAssignments.length}`,
    );

    const skippedSlotOutputs = await handleSkippedSlots(
      skippedAssignments,
      loggerFactory,
      logPathsSet,
      logPaths,
    );

    const runSingle = (adapter: string, reviewIndex: number) =>
      this.runSingleReview(
        adapter,
        reviewIndex,
        config,
        diff,
        getAdapterLogger,
        mainLogger,
        loggerFactory,
        previousFailures,
        rerunThreshold,
        logDir,
        adapterConfigs,
      );

    const outputs = await dispatchReviews(
      runningAssignments,
      parallel,
      runSingle,
    );
    if (outputs.length < runningAssignments.length) {
      return incompleteResult(
        jobId,
        startTime,
        logPaths,
        mainLogger,
        runningAssignments.length,
        outputs.length,
      );
    }
    return buildFinalResult(
      jobId,
      startTime,
      logPaths,
      outputs,
      skippedSlotOutputs,
      mainLogger,
    );
  }

  private async runSingleReview(
    toolName: string,
    reviewIndex: number,
    config: ReviewConfig,
    diff: string,
    getAdapterLogger: LoggerBundle['getAdapterLogger'],
    mainLogger: (output: string) => Promise<void>,
    loggerFactory: LoggerFactory,
    previousFailures?: Map<string, PreviousViolation[]>,
    rerunThreshold: 'critical' | 'high' | 'medium' | 'low' = 'high',
    logDir?: string,
    adapterConfigs?: Record<string, AdapterConfig>,
  ): Promise<SingleReviewResult | null> {
    const reviewStartTime = Date.now();
    const adapter = getAdapter(toolName);
    if (!adapter) return null;
    if (!adapter.name || typeof adapter.name !== 'string') {
      await mainLogger(
        `Error: Invalid adapter name: ${JSON.stringify(adapter.name)}\n`,
      );
      return null;
    }
    const adapterLogger = await getAdapterLogger(adapter.name, reviewIndex);
    const { logPath } = await loggerFactory(adapter.name, reviewIndex);
    try {
      return await this.executeReview(
        adapter,
        reviewIndex,
        config,
        diff,
        adapterLogger,
        mainLogger,
        logPath,
        previousFailures,
        rerunThreshold,
        logDir,
        adapterConfigs,
        toolName,
        reviewStartTime,
      );
    } catch (error: unknown) {
      return handleReviewError(
        error,
        adapter,
        reviewIndex,
        reviewStartTime,
        adapterLogger,
        mainLogger,
        logDir,
      );
    }
  }

  private async executeReview(
    adapter: CLIAdapter,
    reviewIndex: number,
    config: ReviewConfig,
    diff: string,
    adapterLogger: (msg: string) => Promise<void>,
    mainLogger: (msg: string) => Promise<void>,
    logPath: string,
    previousFailures: Map<string, PreviousViolation[]> | undefined,
    rerunThreshold: 'critical' | 'high' | 'medium' | 'low',
    logDir: string | undefined,
    adapterConfigs: Record<string, AdapterConfig> | undefined,
    toolName: string,
    reviewStartTime: number,
  ): Promise<SingleReviewResult | null> {
    await adapterLogger(
      `[START] review:.:${config.name} (${adapter.name}@${reviewIndex})\n`,
    );

    const indexKey = String(reviewIndex);
    const adapterPreviousViolations =
      previousFailures?.get(indexKey) ??
      previousFailures?.get(adapter.name) ??
      [];
    const finalPrompt = buildReviewPrompt(config, adapterPreviousViolations);
    logInputStats(finalPrompt, diff, adapterLogger);
    await adapterLogger(`[diff]\n${diff}\n`);

    const output = await invokeAdapter(
      adapter,
      finalPrompt,
      diff,
      config,
      adapterConfigs?.[toolName],
      adapterLogger,
    );
    await adapterLogger(
      `\n--- Review Output (${adapter.name}) ---\n${output}\n`,
    );

    const evaluation = evaluateOutput(output, diff);
    if (evaluation.status === 'error' && isUsageLimit(output)) {
      await handleUsageLimit(adapter, logDir, mainLogger);
      return {
        adapter: adapter.name,
        reviewIndex,
        duration: Date.now() - reviewStartTime,
        evaluation: { status: 'error', message: 'Usage limit exceeded' },
      };
    }

    await applyRerunFiltering(
      evaluation,
      adapterPreviousViolations,
      rerunThreshold,
      adapterLogger,
    );
    const skipped = await handleReviewOutput(
      evaluation,
      adapter,
      reviewIndex,
      output,
      logPath,
      adapterLogger,
      mainLogger,
      logDir,
    );
    return {
      adapter: adapter.name,
      reviewIndex,
      duration: Date.now() - reviewStartTime,
      evaluation: {
        status: evaluation.status,
        message: evaluation.message,
        json: evaluation.json,
        skipped,
      },
    };
  }

  public evaluateOutput(output: string, diff?: string): EvaluationResult {
    return evaluateOutput(output, diff);
  }

  private async getDiff(
    entryPointPath: string,
    baseBranch: string,
    options?: { commit?: string; uncommitted?: boolean; fixBase?: string },
  ): Promise<string> {
    return getDiff(entryPointPath, baseBranch, options);
  }
}

async function invokeAdapter(
  adapter: CLIAdapter,
  prompt: string,
  diff: string,
  config: ReviewConfig,
  adapterCfg: AdapterConfig | undefined,
  adapterLogger: (msg: string) => Promise<void>,
): Promise<string> {
  return adapter.execute({
    prompt,
    diff,
    model: adapterCfg?.model ?? config.model,
    timeoutMs: config.timeout
      ? config.timeout * 1000
      : REVIEW_ADAPTER_TIMEOUT_MS,
    onOutput: (chunk: string) => {
      adapterLogger(chunk);
    },
    allowToolUse: adapterCfg?.allow_tool_use,
    thinkingBudget: adapterCfg?.thinking_budget,
  });
}
