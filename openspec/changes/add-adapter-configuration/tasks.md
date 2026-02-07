## 0. Pre-factoring

No hotspots require pre-factoring. Both hotspot files (`review.ts` at 7.2, `runner.ts` at 8.37) are modified only with additive parameter changes that do not interact with the complex code paths (see `design.md` Pre-factoring section).

## 1. Implementation

- [ ] 1.1 Add `adapterConfigSchema` to `src/config/schema.ts` with `allow_tool_use` (boolean, default true) and `thinking_budget` (enum `off|low|medium|high`, optional)
- [ ] 1.2 Update `cliConfigSchema` in `src/config/schema.ts` to include optional `adapters: z.record(z.string(), adapterConfigSchema)`
- [ ] 1.3 Export `AdapterConfig` type from `src/config/types.ts`
- [ ] 1.4 Create `src/cli-adapters/thinking-budget.ts` with `CLAUDE_THINKING_TOKENS`, `CODEX_REASONING_EFFORT`, and `GEMINI_THINKING_BUDGET` level-to-value maps
- [ ] 1.5 Extend `CLIAdapter.execute()` opts in `src/cli-adapters/index.ts` with optional `allowToolUse?: boolean` and `thinkingBudget?: string`
- [ ] 1.6 Update Claude adapter (`src/cli-adapters/claude.ts`):
  - Dynamic args construction based on `opts.allowToolUse` (toggle `--tools ""` vs `--allowedTools`)
  - Add `MAX_THINKING_TOKENS` env var based on `opts.thinkingBudget`
  - Refactor `execAsync` fallback to build command string from args array
- [ ] 1.7 Update Codex adapter (`src/cli-adapters/codex.ts`):
  - Dynamic args for `--disable shell_tool` based on `opts.allowToolUse`
  - Add `-c model_reasoning_effort="..."` based on `opts.thinkingBudget`
  - Refactor `execAsync` fallback to build command string from args array
- [ ] 1.8 Update Gemini adapter (`src/cli-adapters/gemini.ts`):
  - Dynamic args construction to conditionally include `--allowed-tools`
  - Add `applyThinkingSettings()` private method for temporary `.gemini/settings.json`
  - Wrap execution in try/finally for settings cleanup
  - Refactor `execAsync` fallback to build command string from args array
- [ ] 1.9 Update review gate (`src/gates/review.ts`):
  - Add `adapterConfigs?: Record<string, AdapterConfig>` parameter to `execute()` signature
  - Thread to `runSingleReview()`
  - Look up adapter config by tool name and pass `allowToolUse` / `thinkingBudget` to `adapter.execute()`
- [ ] 1.10 Update runner (`src/core/runner.ts`):
  - Pass `this.config.project.cli?.adapters` to `reviewExecutor.execute()`
- [ ] 1.11 Update `.gauntlet/config.yml` with `adapters` section setting `thinking_budget: high` for all three adapters (claude, codex, gemini)

## 2. Tests

- [ ] 2.1 Unit test for adapter config schema validation (valid configs, invalid thinking_budget values, defaults)
- [ ] 2.2 Unit test for thinking budget maps (all levels map to expected values for each adapter)
- [ ] 2.3 Unit test for Claude adapter: verify args include `--tools ""` when `allowToolUse: false`, and `MAX_THINKING_TOKENS` env var set for each thinking budget level
- [ ] 2.4 Unit test for Codex adapter: verify args include `--disable shell_tool` when `allowToolUse: false`, and `-c model_reasoning_effort="..."` for each thinking budget level
- [ ] 2.5 Unit test for Gemini adapter: verify `--allowed-tools` is omitted when `allowToolUse: false`, and `.gemini/settings.json` is written/restored for thinking budget
- [ ] 2.6 Integration test for review gate: verify adapter config is threaded from execute() to adapter.execute() call

## 3. Validation

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
