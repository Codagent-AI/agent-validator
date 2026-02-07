# Change: Add Per-Adapter Configuration for Tool Use and Thinking Budget

## Why
Gemini reviews are expensive when run with tool use enabled (~35k+ tokens per review). Allowing per-adapter configuration of tool use and thinking budget in `config.yml` makes Gemini viable as a cost-effective diff-only reviewer alongside Claude and Codex, and gives operators fine-grained control over each adapter's reasoning behavior.

## What Changes
- Add `adapters` section to `cli` config in `.gauntlet/config.yml` with per-adapter `allow_tool_use` (boolean) and `thinking_budget` (level string) settings
- Extend `CLIAdapter.execute()` interface with optional `allowToolUse` and `thinkingBudget` parameters
- Create shared thinking budget level-to-value mapping module
- Update Claude, Codex, and Gemini adapters to dynamically construct CLI args based on adapter config
- Thread adapter config from project config through runner and review gate to adapter execution
- Gemini thinking budget requires temporary `.gemini/settings.json` manipulation (no CLI flag available)

## Impact
- Affected specs: `review-config` (adding adapter configuration requirements)
- Affected code:
  - `src/config/schema.ts` — new `adapterConfigSchema`, updated `cliConfigSchema`
  - `src/config/types.ts` — new `AdapterConfig` type export
  - `src/cli-adapters/index.ts` — extended `execute()` opts interface
  - `src/cli-adapters/thinking-budget.ts` — **new file**, level-to-value maps
  - `src/cli-adapters/claude.ts` — dynamic args + env for tool use & thinking
  - `src/cli-adapters/codex.ts` — dynamic args for tool use & reasoning effort
  - `src/cli-adapters/gemini.ts` — dynamic args + temp settings.json for thinking
  - `src/gates/review.ts` — accept + thread `adapterConfigs` parameter
  - `src/core/runner.ts` — pass adapter configs to review executor
  - `.gauntlet/config.yml` — add `adapters` section with `thinking_budget: high` for all three adapters
