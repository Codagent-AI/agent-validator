# Change: Move Unhealthy Adapter State to Global Storage

## Why
Project-scoped unhealthy adapter tracking is reset by `clean`, causing adapters that hit usage limits (e.g. Codex) to be retried immediately. This wastes time and repeatedly hits provider limits. A global cooldown state removes this friction and keeps adapter health consistent across projects.

## What Changes
- Store unhealthy adapter state in a global file under the global config directory (with an env override for tests and tooling).
- Introduce a dedicated utility module for unhealthy adapter persistence; remove this responsibility from `execution-state.ts`.
- Keep `.execution_state` focused on per-project run metadata only (timestamp, branch, commit, working tree ref).
- Update review adapter selection/health logic to use global unhealthy adapter state.
- Preserve global unhealthy adapter state across project `clean`.
- Update documentation and tests to reflect global storage.

## Impact
- Affected specs: `run-lifecycle`
- Affected code:
  - `src/utils/unhealthy-adapters.ts` (new)
  - `src/utils/execution-state.ts` (remove unhealthy adapter persistence)
  - `src/gates/review.ts` (use global unhealthy adapter state)
  - Tests: `test/utils/execution-state.test.ts`, `test/gates/review.test.ts`
  - Docs: `docs/cli-invocation-details.md`
