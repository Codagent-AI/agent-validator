import type { LoadedConfig } from '../config/types.js';
import type { PreviousViolation } from '../utils/log-parser.js';
import { sanitizeJobId } from '../utils/sanitizer.js';
import { EntryPointExpander } from './entry-point.js';
import { type Job, JobGenerator } from './job.js';

interface RerunCheckRecoveryContext {
  config: LoadedConfig;
  options: {
    enableReviews?: Set<string>;
  };
}

function hasOnlyCheckFailures(
  failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
): boolean {
  if (!failuresMap || failuresMap.size === 0) return false;
  return Array.from(failuresMap.keys()).every((jobId) =>
    jobId.startsWith('check_'),
  );
}

export async function findPreviousFailedCheckJobs(
  ctx: RerunCheckRecoveryContext,
  failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
): Promise<Job[]> {
  if (!hasOnlyCheckFailures(failuresMap)) return [];

  const failedJobIds = new Set(failuresMap?.keys());
  const expander = new EntryPointExpander();
  const jobGen = new JobGenerator(ctx.config, ctx.options.enableReviews);
  const allEntryPoints = await expander.expandAll(
    ctx.config.project.entry_points,
  );

  return jobGen
    .generateJobs(allEntryPoints)
    .filter(
      (job) => job.type === 'check' && failedJobIds.has(sanitizeJobId(job.id)),
    );
}
