import type { loadConfig } from '../config/loader.js';

/**
 * Compute effective base branch from options, env vars, and config.
 *
 * Precedence:
 *  1. Explicit CLI option (`--base-branch`)
 *  2. GITHUB_BASE_REF env var (only when running in CI)
 *  3. Project-level `base_branch` from config.yml
 */
export function resolveBaseBranch(
  options: { baseBranch?: string },
  config: Awaited<ReturnType<typeof loadConfig>>,
): string {
  return (
    options.baseBranch ||
    (process.env.GITHUB_BASE_REF &&
    (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true')
      ? process.env.GITHUB_BASE_REF
      : null) ||
    config.project.base_branch
  );
}
