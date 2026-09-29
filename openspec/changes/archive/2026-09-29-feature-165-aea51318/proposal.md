## Why

`thinking_budget` is Agent Validator's single, adapter-neutral knob for how hard a reviewer should
think. Most adapters turn it into a real effort level. Codex gets `model_reasoning_effort`, GitHub
Copilot gets `--effort`, and OpenCode gets `--variant`. The Claude adapter only sets
`MAX_THINKING_TOKENS` (`src/cli-adapters/thinking-budget.ts`, `src/cli-adapters/claude.ts`) and never
passes an effort setting.

That gap matters because current Claude models (the Sonnet/Opus 4.6+ line, including Sonnet 5.5) use
adaptive thinking. On those models, Claude Code ignores a positive `MAX_THINKING_TOKENS`. As a
result, `thinking_budget: low`, `medium`, and `high` all run Claude at
its default effort today. Two things go wrong:

- **Configurations do nothing.** A user who sets `cli.adapters.claude.thinking_budget: low` to save
  cost or latency gets no change in behavior.
- **Eval conditions are mislabeled.** An eval round that compares Codex models at low effort against
  Claude Sonnet 5.5 at low effort is actually comparing Codex-low against Claude-default. The
  `AGENT_VALIDATOR_REVIEWER_EFFORT` override from Agent Runner hits the same problem: it maps effort
  onto `thinking_budget`, and the Claude adapter then drops it.

The fix is feasible now. The installed Claude Code CLI (2.1.284) has an effort control for each
session. It is available as the `--effort <low|medium|high|xhigh|max>` flag and as the
`CLAUDE_CODE_EFFORT_LEVEL` environment variable. A local probe showed that `--effort low` is accepted
for both Sonnet and Haiku, so the setting is safe to pass even when the model has no effort support.

**Verdict: go.** The change is small and additive. It reuses the existing config surface and mirrors
how Codex and Copilot already work. It fixes a correctness gap in a setting users already rely on: the
configured level is actually applied, and eval conditions are stated accurately.

This change does not make effort levels equal across adapters. Effort levels are calibrated per model,
even within Claude, so `low` on Claude and `low` on Codex are matching experimental settings, not
equal amounts of reasoning, cost, or review quality. A like-for-like comparison still has to rest on
measured cost, latency, and review outcomes.

## What Changes

- When `thinking_budget` is `low`, `medium`, or `high`, the Claude adapter also passes the same value
  as the Claude Code effort level, alongside the existing `MAX_THINKING_TOKENS` value.
- `thinking_budget: off` keeps today's behavior: `MAX_THINKING_TOKENS=0` and no effort setting. Effort
  levels cannot express "no thinking", so `off` stays tied to the token budget. That is only a request
  to disable thinking. Claude Code documents that some models, including Sonnet 5.5 and Opus 5.5,
  cannot have thinking turned off, and `MAX_THINKING_TOKENS=0` has no effect on them. The contract and
  documentation will say that `off` disables thinking only on models that support it. The adapter will
  not keep a list of models to detect this or warn about it.
- When `thinking_budget` is not set, the adapter still applies no override. Claude Code keeps its own
  default effort.
- The resolved Claude launch identity records the effort value placed in the child's environment, with
  `launch_resolution` provenance. That value is either the mapped level or, when the adapter sets none,
  an inherited `CLAUDE_CODE_EFFORT_LEVEL`. When neither is present, the value is `null`. The requested
  identity keeps the configured `thinking_budget`. The actual or observed effort stays unavailable,
  because the Claude CLI does not report it. The level can differ from what was launched because of
  model support and managed `maxEffortLevel` caps.
- The adapter documentation and the `review-config` mapping requirement are updated to describe the
  Claude effort mapping.
- **Behavior change (not breaking):** existing configs that set `thinking_budget` for Claude will now
  change how much Claude reasons. For example, `low` becomes genuinely lower effort, which is cheaper
  and faster but may give shallower reviews. The config schema, accepted values, and persisted formats
  do not change.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `review-config`: the "Adapter Thinking Budget Level Mapping" requirement adds a Claude effort
  mapping (`low`→`low`, `medium`→`medium`, `high`→`high`; `off` sets no effort). It also adds
  scenarios for how effort is passed to Claude, including the `off` and unset cases. It also states
  that `off` cannot disable thinking on models that always think. The existing `validation-metrics`
  provenance rules already cover the launch-resolved and observed effort distinction, and this change
  follows them without modifying them.

## Technical Approach

The change stays inside the Claude adapter and the shared mapping table:

- Add a `CLAUDE_EFFORT_LEVEL` map to `src/cli-adapters/thinking-budget.ts`, next to the existing
  per-adapter maps. `off` has no entry.
- In `ClaudeAdapter.doExecute`, build the effort setting in the same place that builds
  `MAX_THINKING_TOKENS`.
- **Recommended mechanism: the `CLAUDE_CODE_EFFORT_LEVEL` environment variable.** The Claude adapter
  already sends its thinking controls through the environment. Older Claude Code versions ignore an
  unknown environment variable, but they reject an unknown `--effort` flag, which would make every
  Claude review fail. The trade-off is that an environment variable is less visible in logged CLI
  arguments than a flag. Recording the effort in the launch telemetry makes up for that. The design
  step should confirm this choice. The `--effort` flag is the fallback if the design finds that the
  variable has weaker precedence (for example, below a user's `effortLevel` setting).
- Keep `MAX_THINKING_TOKENS` for `low`, `medium`, and `high`. Models without adaptive thinking (for
  example, Haiku and older Sonnet/Opus) still honor it, and adaptive models ignore it. Keeping both
  signals gives the best available match to "low", "medium", and "high" on every Claude model.
- Pass the launch-resolved effort (the value in the child environment) to the Claude telemetry path
  separately from `thinkingBudget`. Today `createUnavailableTelemetry` and the OTel parser copy the
  requested budget into `resolved_identity.effort`. For Claude, that field comes from the environment
  value instead. No observed effort is recorded.

## Out of Scope

- Adding `xhigh` or `max` to the `thinking_budget` enum. That changes the public config schema, and
  other adapters would need matching mappings. The reviewer-override collapse of `xhigh` to `high`
  stays as it is.
- Changing token budgets or effort mappings for other adapters (Codex, Gemini, Cursor, Copilot,
  OpenCode).
- Changing the `thinking_budget` default that `init` writes for Claude (`high`).
- Detecting or blocking Claude Code versions that don't support effort. With the environment
  variable, those versions just keep today's behavior.
- Re-running or re-baselining the eval results in `docs/eval-results.md`.

## Impact

- **Code:** `src/cli-adapters/thinking-budget.ts` and `src/cli-adapters/claude.ts` (building the
  environment and passing telemetry options), `src/cli-adapters/claude-otel.ts` (the resolved effort is
  taken from the launch environment instead of the requested budget), and possibly the Claude call to
  `createUnavailableTelemetry` in `src/cli-adapters/shared.ts`.
- **Tests:** the Claude adapter unit tests that check the environment passed to the spawned CLI, plus
  the thinking-budget mapping tests.
- **Specs:** `openspec/specs/review-config/spec.md` (the Adapter Thinking Budget Level Mapping
  requirement).
- **Docs:** `docs/cli-invocation-details.md`, `docs/config-reference.md`, and
  `docs/reviews-and-adapters.md` (the Claude thinking-budget description).
- **Users:** Claude reviewers with `thinking_budget` set will see different cost, latency, and review
  depth. Eval runs actually apply the configured Claude effort, so their conditions are labeled
  accurately. Matching level names across adapters is still only an experimental control, not proof of
  equal effort.
- **Dependencies:** no new packages. The change relies on Claude Code's `CLAUDE_CODE_EFFORT_LEVEL`,
  which is present in 2.1.x.
