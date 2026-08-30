import type { LoadedConfig } from '../config/types.js';
import { findErroredReviewScopes } from '../utils/log-parser.js';
import { sanitizeJobId } from '../utils/sanitizer.js';
import { EntryPointExpander } from './entry-point.js';
import { type Job, JobGenerator } from './job.js';

interface RerunReviewRecoveryContext {
  config: LoadedConfig;
  options: {
    gate?: string;
    enableReviews?: Set<string>;
  };
}

export async function findPreviousErroredReviewJobs(
  ctx: RerunReviewRecoveryContext,
): Promise<Job[]> {
  const scopes = await findErroredReviewScopes(ctx.config.project.log_dir);
  if (scopes.size === 0) return [];

  const expander = new EntryPointExpander();
  const jobGen = new JobGenerator(ctx.config, ctx.options.enableReviews);
  const allEntryPoints = await expander.expandAll(
    ctx.config.project.entry_points,
  );

  return jobGen
    .generateJobs(allEntryPoints)
    .filter(
      (job) =>
        job.type === 'review' &&
        (!ctx.options.gate || job.name === ctx.options.gate) &&
        scopes.has(sanitizeJobId(job.id)),
    )
    .map((job) => ({
      ...job,
      reviewChangeOptions: scopes.get(sanitizeJobId(job.id)) ?? null,
    }));
}
