import {
  type AdapterExecutionResult,
  type CLIAdapter,
  createUnavailableTelemetry,
} from '../cli-adapters/shared.js';
import type { AdapterConfig } from '../config/types.js';
import type { ReviewConfig } from './review-types.js';
import { REVIEW_ADAPTER_TIMEOUT_MS } from './review-types.js';

export async function invokeAdapter(
  adapter: CLIAdapter,
  prompt: string,
  diff: string,
  config: ReviewConfig,
  adapterCfg: AdapterConfig | undefined,
  adapterLogger: (msg: string) => Promise<void>,
): Promise<AdapterExecutionResult> {
  const result = await adapter.execute({
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
  // Compatibility for existing injected test doubles. Production adapters use
  // the structured contract above; this fallback never manufactures usage.
  return typeof result === 'string'
    ? { text: result, telemetry: createUnavailableTelemetry(adapter.name) }
    : result;
}
