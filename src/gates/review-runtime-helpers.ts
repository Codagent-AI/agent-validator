import type { CLIAdapter } from '../cli-adapters/index.js';
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
