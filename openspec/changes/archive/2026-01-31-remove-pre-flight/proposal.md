# Change: Remove preflight checks and auto-detect usage limits at runtime

## Why
Preflight checks are slow and token-expensive. The `check_usage_limit` setting sends a throwaway "hello" prompt to every adapter before any real work begins, wasting tokens and adding latency. Tool-existence checks (e.g. `which bun`) are redundant since execution-time failures already produce clear errors. The system should detect usage limits from actual review output and track adapter health across runs with a cooldown.

## What Changes
- **BREAKING** Remove the `check_usage_limit` config setting
- Remove the entire preflight phase from the Runner (both command-existence checks and adapter health probes)
- Detect usage limits from actual review adapter output at execution time
- Mark adapters as unhealthy in `.execution_state` when a usage limit is detected
- Skip unhealthy adapters for 1 hour (cooldown), then attempt a lightweight availability probe
- Simplify `CLIAdapter.checkHealth()` to only verify binary availability (no "hello" prompt)

## Impact
- Affected specs: `run-lifecycle`, `log-management`
- Affected code:
  - `src/core/runner.ts` (remove preflight method and related helpers)
  - `src/gates/review.ts` (add runtime usage-limit detection, cooldown filtering)
  - `src/utils/execution-state.ts` (add `unhealthy_adapters` field and helpers)
  - `src/cli-adapters/index.ts` (simplify `CLIAdapter` interface)
  - `src/cli-adapters/claude.ts`, `gemini.ts`, `codex.ts`, `cursor.ts`, `github-copilot.ts` (simplify `checkHealth`)
  - `src/config/schema.ts` (remove `check_usage_limit`)
  - `src/commands/health.ts` (remove usage-limit check)
