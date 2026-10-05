import {
  AdapterExecutionFailure,
  type AdapterExecutionResult,
  type AdapterTelemetry,
  type CLIAdapter,
  createUnavailableTelemetry,
} from '../cli-adapters/shared.js';
import type { AdapterConfig } from '../config/types.js';
import type { CommandMetricsLifecycle } from '../metrics/command-lifecycle.js';
import { evaluateOutput } from './review-eval.js';
import type { EvaluationResult, ReviewConfig } from './review-types.js';
import { REVIEW_ADAPTER_TIMEOUT_MS } from './review-types.js';

export async function invokeAdapter(
  adapter: CLIAdapter,
  prompt: string,
  diff: string,
  config: ReviewConfig,
  adapterCfg: AdapterConfig | undefined,
  adapterLogger: (msg: string) => Promise<void>,
  collection?: {
    attemptId: string;
    onTelemetry: (telemetry: AdapterTelemetry) => void;
  },
): Promise<AdapterExecutionResult> {
  const result = await adapter.execute({
    prompt,
    diff,
    model: config.model ?? adapterCfg?.model,
    timeoutMs: config.timeout
      ? config.timeout * 1000
      : REVIEW_ADAPTER_TIMEOUT_MS,
    onOutput: (chunk: string) => {
      adapterLogger(chunk);
    },
    allowToolUse: adapterCfg?.allow_tool_use,
    thinkingBudget: adapterCfg?.thinking_budget,
    ...collection,
  });
  // Compatibility for existing injected test doubles. Production adapters use
  // the structured contract above; this fallback never manufactures usage.
  return typeof result === 'string'
    ? { text: result, telemetry: createUnavailableTelemetry(adapter.name) }
    : result;
}

export async function executeReviewAttempt(args: {
  adapter: CLIAdapter;
  reviewIndex: number;
  prompt: string;
  diff: string;
  config: ReviewConfig;
  adapterConfig?: AdapterConfig;
  adapterLogger: (msg: string) => Promise<void>;
  metrics?: CommandMetricsLifecycle;
  retry?: boolean;
}): Promise<{
  output: string;
  evaluation: EvaluationResult;
  attemptId?: string;
}> {
  const { adapter, metrics, adapterLogger } = args;
  const preparedAttempt = await metrics?.prepareAttempt({
    adapter: adapter.name,
    gate: args.config.name,
    slot: args.reviewIndex,
    telemetry: createUnavailableTelemetry(adapter.name, {
      requestedModel: args.config.model ?? args.adapterConfig?.model,
    }),
  });
  let adapterResult: AdapterExecutionResult;
  try {
    adapterResult = await invokeAdapter(
      adapter,
      args.prompt,
      args.diff,
      args.config,
      args.adapterConfig,
      adapterLogger,
      preparedAttempt && metrics
        ? {
            attemptId: preparedAttempt.attempt_id,
            onTelemetry: (telemetry) => {
              void metrics.observeAttempt(preparedAttempt, telemetry);
            },
          }
        : undefined,
    );
  } catch (error) {
    await metrics?.finalizeAttempt(
      preparedAttempt ?? { attempt_id: '', record: null },
      error instanceof AdapterExecutionFailure
        ? error.telemetry
        : createUnavailableTelemetry(adapter.name, {
            reason: 'adapter_execution_failed',
          }),
      'error',
    );
    throw error;
  }
  const output = adapterResult.text;
  await adapterLogger(
    `\n--- Review Output (${adapter.name}${args.retry ? ', retry' : ''}) ---\n${output}\n`,
  );
  const evaluation = evaluateOutput(output, args.diff);
  await metrics?.finalizeAttempt(
    preparedAttempt ?? { attempt_id: '', record: null },
    adapterResult.telemetry,
    reviewOutcome(evaluation.status),
  );
  return { output, evaluation, attemptId: preparedAttempt?.attempt_id };
}

function reviewOutcome(
  status: EvaluationResult['status'],
): 'passed' | 'failed' | 'error' {
  if (status === 'pass') return 'passed';
  if (status === 'fail') return 'failed';
  return 'error';
}
