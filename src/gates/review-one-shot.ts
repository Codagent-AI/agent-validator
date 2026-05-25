import fs from 'node:fs/promises';
import { parseReviewFilename } from '../utils/log-parser-helpers.js';
import { sanitizeJobId } from '../utils/sanitizer.js';
import type { ReviewFullJsonOutput } from './result.js';
import type { LoggerFactory } from './review-helpers.js';
import type { ReviewConfig, ReviewOutputEntry } from './review-types.js';

export interface OneShotState {
  outputs: ReviewOutputEntry[];
  runningSlotIndexes: Set<number>;
  forceFirstRun: boolean;
}

interface PriorReviewJson {
  adapter: string;
  runNumber: number;
  data: ReviewFullJsonOutput;
}

export async function prepareOneShotPreservation(opts: {
  jobId: string;
  config: ReviewConfig;
  required: number;
  loggerFactory: LoggerFactory;
  logPathsSet: Set<string>;
  logPaths: string[];
  logDir?: string;
}): Promise<OneShotState> {
  const outputs: ReviewOutputEntry[] = [];
  const runningSlotIndexes = new Set<number>();
  const { config, logDir } = opts;
  if (!(config.one_shot && logDir)) {
    return { outputs, runningSlotIndexes, forceFirstRun: false };
  }

  let forceFirstRun = false;
  for (let reviewIndex = 1; reviewIndex <= opts.required; reviewIndex++) {
    const prior = await readLatestReviewJsonForSlot(
      logDir,
      opts.jobId,
      reviewIndex,
    );
    if (!prior || prior.data.status === 'error') {
      runningSlotIndexes.add(reviewIndex);
      forceFirstRun = true;
      continue;
    }

    outputs.push(await writePreservedOneShotLog(prior, reviewIndex, opts));
  }

  return { outputs, runningSlotIndexes, forceFirstRun };
}

async function readLatestReviewJsonForSlot(
  logDir: string,
  jobId: string,
  reviewIndex: number,
): Promise<PriorReviewJson | null> {
  let files: string[];
  try {
    files = await fs.readdir(logDir);
  } catch {
    return null;
  }

  const safeJobId = sanitizeJobId(jobId);
  const candidates = files
    .map((filename) => ({ filename, parsed: parseReviewFilename(filename) }))
    .filter(
      (
        entry,
      ): entry is {
        filename: string;
        parsed: NonNullable<ReturnType<typeof parseReviewFilename>>;
      } =>
        entry.parsed !== null &&
        entry.parsed.ext === 'json' &&
        entry.parsed.jobId === safeJobId &&
        entry.parsed.reviewIndex === reviewIndex,
    )
    .sort((a, b) => b.parsed.runNumber - a.parsed.runNumber);

  const latest = candidates[0];
  if (!latest) return null;

  try {
    const content = await fs.readFile(`${logDir}/${latest.filename}`, 'utf-8');
    const data = JSON.parse(content) as ReviewFullJsonOutput;
    if (!data || typeof data.status !== 'string') return null;
    return {
      adapter: data.adapter || latest.parsed.adapter,
      runNumber: latest.parsed.runNumber,
      data,
    };
  } catch {
    return null;
  }
}

async function writePreservedOneShotLog(
  prior: PriorReviewJson,
  reviewIndex: number,
  opts: {
    loggerFactory: LoggerFactory;
    logPathsSet: Set<string>;
    logPaths: string[];
  },
): Promise<ReviewOutputEntry> {
  const { logger, logPath } = await opts.loggerFactory(
    prior.adapter,
    reviewIndex,
  );
  const violations = prior.data.violations || [];
  const activeCount = violations.filter(
    (violation) => !violation.status || violation.status === 'new',
  ).length;
  const hasNewViolation = activeCount > 0;
  const outputStatus = hasNewViolation ? 'fail' : 'pass';
  const jsonStatus = hasNewViolation ? 'fail' : 'preserved_one_shot';

  await logger(
    `Preserved one-shot review state from iteration ${prior.runNumber} (no AI dispatch)\n`,
  );
  await logger(`Adapter: ${prior.adapter}\n`);
  await logger(`Review index: @${reviewIndex}\n`);
  await logger(`Status: ${jsonStatus}\n`);

  const jsonPath = logPath.replace(/\.log$/, '.json');
  const preservedOutput: ReviewFullJsonOutput = {
    adapter: prior.adapter,
    timestamp: new Date().toISOString(),
    status: jsonStatus,
    rawOutput: '',
    violations,
    preservedFromIteration: prior.runNumber,
  };
  await fs.writeFile(jsonPath, JSON.stringify(preservedOutput, null, 2));

  if (!opts.logPathsSet.has(logPath)) {
    opts.logPathsSet.add(logPath);
    opts.logPaths.push(logPath);
  }

  return buildPreservedOutputEntry(
    prior.adapter,
    reviewIndex,
    outputStatus,
    violations,
    prior.runNumber,
    activeCount,
  );
}

function buildPreservedOutputEntry(
  adapter: string,
  reviewIndex: number,
  status: 'pass' | 'fail',
  violations: ReviewFullJsonOutput['violations'],
  priorIteration: number,
  activeCount: number,
): ReviewOutputEntry {
  const message =
    status === 'fail'
      ? `Preserved one-shot review state from iteration ${priorIteration} with ${activeCount} active violation(s)`
      : `Preserved one-shot review state from iteration ${priorIteration}`;
  return {
    adapter,
    reviewIndex,
    status,
    message,
    json: {
      status,
      violations,
      message: status === 'pass' ? message : undefined,
    },
  };
}
