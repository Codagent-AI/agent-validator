import type { AdapterConfig } from '../config/types.js';
import type { CommandMetricsLifecycle } from '../metrics/command-lifecycle.js';
import type { PreviousViolation, ReviewChangeOptions } from './result.js';
import type { LoggerBundle, LoggerFactory } from './review-helpers.js';
import type { ReviewConfig, ReviewOutputEntry } from './review-types.js';

export interface DispatchForDiffArgs {
  jobId: string;
  config: ReviewConfig;
  diff: string;
  required: number;
  parallel: boolean;
  mainLogger: (output: string) => Promise<void>;
  getAdapterLogger: LoggerBundle['getAdapterLogger'];
  loggerFactory: LoggerFactory;
  logPaths: string[];
  logPathsSet: Set<string>;
  startTime: number;
  previousFailures?: Map<string, PreviousViolation[]>;
  rerunThreshold: 'critical' | 'high' | 'medium' | 'low';
  passedSlots?: Map<number, { adapter: string; passIteration: number }>;
  logDir?: string;
  adapterConfigs?: Record<string, AdapterConfig>;
  contextContent?: string;
  changeOptions?: ReviewChangeOptions;
  oneShotOutputs: ReviewOutputEntry[];
  runningSlotIndexes: Set<number>;
  metrics?: CommandMetricsLifecycle;
}
