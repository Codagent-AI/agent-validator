import {
  type CLIAdapter,
  getAdapter,
  isUsageLimit,
} from '../cli-adapters/index.js';
import type { AdapterConfig } from '../config/types.js';
import { getCategoryLogger } from '../output/app-logger.js';
import type {
  GateResult,
  PreviousViolation,
  ReviewChangeOptions,
} from './result.js';
import {
  buildFinalResult,
  emptyDiffResult,
  handleCriticalError,
  incompleteResult,
  noAdaptersResult,
} from './review-agg.js';
import { getDiff } from './review-diff.js';
import type { DispatchForDiffArgs } from './review-dispatch-types.js';
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
import {
  persistOneShotReviewScope,
  prepareOneShotPreservation,
} from './review-one-shot.js';
import { invokeAdapter } from './review-runtime-helpers.js';
import type {
  EvaluationResult,
  ReviewConfig,
  ReviewOutputEntry,
  SingleReviewResult,
} from './review-types.js';

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
    changeOptions?: ReviewChangeOptions,
    rerunThreshold: 'critical' | 'high' | 'medium' | 'low' = 'high',
    passedSlots?: Map<number, { adapter: string; passIteration: number }>,
    logDir?: string,
    adapterConfigs?: Record<string, AdapterConfig>,
    contextContent?: string,
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
        contextContent,
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
    changeOptions?: ReviewChangeOptions,
    rerunThreshold: 'critical' | 'high' | 'medium' | 'low' = 'high',
    passedSlots?: Map<number, { adapter: string; passIteration: number }>,
    logDir?: string,
    adapterConfigs?: Record<string, AdapterConfig>,
    contextContent?: string,
  ): Promise<GateResult> {
    log.debug(`Starting review: ${config.name} | entry=${entryPointPath}`);
    await mainLogger(`Starting review: ${config.name}\n`);
    await mainLogger(`Entry point: ${entryPointPath}\n`);
    await mainLogger(`Base branch: ${baseBranch}\n`);

    const required = config.num_reviews ?? 1;
    const oneShotState = await prepareOneShotPreservation({
      jobId,
      config,
      required,
      loggerFactory,
      logPathsSet,
      logPaths,
      logDir,
    });
    if (oneShotState.outputs.length === required) {
      return buildFinalResult(
        jobId,
        startTime,
        logPaths,
        oneShotState.outputs,
        [],
        mainLogger,
      );
    }

    const effectiveChangeOptions =
      oneShotState.retryChangeOptions === undefined
        ? changeOptions
        : (oneShotState.retryChangeOptions ?? undefined);
    const effectivePreviousFailures = oneShotState.resetPromptContext
      ? undefined
      : previousFailures;

    const diff = await this.getDiff(
      entryPointPath,
      baseBranch,
      effectiveChangeOptions,
    );
    logDiffStats(diff, mainLogger);
    if (!diff.trim()) {
      if (oneShotState.outputs.length > 0) {
        return buildFinalResult(
          jobId,
          startTime,
          logPaths,
          oneShotState.outputs,
          [],
          mainLogger,
        );
      }
      return emptyDiffResult(jobId, startTime, logPaths, mainLogger);
    }

    return this.dispatchForDiff({
      jobId,
      config,
      diff,
      required,
      parallel: config.parallel ?? false,
      mainLogger,
      getAdapterLogger,
      loggerFactory,
      logPaths,
      logPathsSet,
      startTime,
      previousFailures: effectivePreviousFailures,
      rerunThreshold,
      passedSlots,
      logDir,
      adapterConfigs,
      contextContent,
      changeOptions: effectiveChangeOptions,
      oneShotOutputs: oneShotState.outputs,
      runningSlotIndexes: oneShotState.runningSlotIndexes,
    });
  }

  private async dispatchForDiff(
    args: DispatchForDiffArgs,
  ): Promise<GateResult> {
    const healthyAdapters = await collectHealthyAdapters(
      args.config.cli_preference || [],
      args.mainLogger,
      args.logDir,
    );
    if (healthyAdapters.length === 0) {
      return noAdaptersResult(
        args.jobId,
        args.startTime,
        args.logPaths,
        args.mainLogger,
      );
    }
    log.debug(`Healthy adapters: ${healthyAdapters.join(', ')}`);

    const assignments = generateReviewAssignments(
      args.required,
      healthyAdapters,
    );
    const effectiveAssignments =
      args.runningSlotIndexes.size > 0
        ? assignments.filter((assignment) =>
            args.runningSlotIndexes.has(assignment.reviewIndex),
          )
        : assignments;
    await applyPassedSlotSkips(
      assignments,
      args.required,
      args.passedSlots,
      args.mainLogger,
    );
    await logSkipMessages(effectiveAssignments, args.mainLogger);

    return this.dispatchAndCollect(
      args.jobId,
      args.config,
      args.diff,
      effectiveAssignments,
      args.required,
      args.parallel,
      args.mainLogger,
      args.getAdapterLogger,
      args.loggerFactory,
      args.logPaths,
      args.logPathsSet,
      args.startTime,
      args.previousFailures,
      args.rerunThreshold,
      args.logDir,
      args.adapterConfigs,
      args.contextContent,
      args.changeOptions,
      args.oneShotOutputs,
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
    contextContent?: string,
    changeOptions?: ReviewChangeOptions,
    preservedOutputs: ReviewOutputEntry[] = [],
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
        contextContent,
        changeOptions,
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
      [...preservedOutputs, ...outputs],
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
    contextContent?: string,
    changeOptions?: ReviewChangeOptions,
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
        contextContent,
        changeOptions,
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
    contextContent?: string,
    changeOptions?: ReviewChangeOptions,
  ): Promise<SingleReviewResult | null> {
    await adapterLogger(
      `[START] review:.:${config.name} (${adapter.name}@${reviewIndex})\n`,
    );
    const reviewScope = config.one_shot
      ? { changeOptions: changeOptions ?? null }
      : undefined;
    if (config.one_shot) {
      await persistOneShotReviewScope(logPath, adapter.name, changeOptions);
    }

    const indexKey = String(reviewIndex);
    const adapterPreviousViolations =
      previousFailures?.get(indexKey) ??
      previousFailures?.get(adapter.name) ??
      [];
    const finalPrompt = buildReviewPrompt(
      config,
      adapterPreviousViolations,
      contextContent,
    );
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
      reviewScope,
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

  private getDiff = getDiff;
}
