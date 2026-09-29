## Context

The Claude adapter (`src/cli-adapters/claude.ts`) runs `claude -p` as a subprocess. It spreads
`process.env` (minus `CLAUDECODE`), the OTel variables, and a `thinkingEnv` object into the child's
environment. Today `thinkingEnv` holds only `MAX_THINKING_TOKENS`, which comes from
`CLAUDE_THINKING_TOKENS` in `src/cli-adapters/thinking-budget.ts`. The adapter never sets an effort
level, so on adaptive-thinking models (Sonnet/Opus 4.6+, including 5.5) `low`, `medium`, and `high`
all run at Claude Code's default effort.

Claude Code 2.1.284 (installed locally) exposes effort in two ways:

- The `--effort <low|medium|high|xhigh|max>` CLI flag.
- The `CLAUDE_CODE_EFFORT_LEVEL` environment variable. In the shipped code, this variable takes
  precedence over the `/effort` command and the saved `effortLevel` setting: Claude reports "overrides
  effort for this session". The values `auto` and `unset` are treated as "no override". A managed
  `maxEffortLevel` can still cap the result.

The telemetry path works like this:

- `ClaudeAdapter.execute()` first builds a baseline with
  `createUnavailableTelemetry('claude', { requestedModel, requestedEffort: thinkingBudget })`, which
  is used if execution throws.
- `doExecute()` then builds telemetry through `createClaudeTelemetryCollector` or
  `parseClaudeOtelTelemetry` (`src/cli-adapters/claude-otel.ts`). Both call
  `createUnavailableTelemetry` with `requestedEffort: opts.thinkingBudget`.
- `createUnavailableTelemetry` (`src/cli-adapters/shared.ts`) copies `requestedEffort` into both
  `requested_identity.effort` and `resolved_identity.effort`.

Other callers that pass `thinking_budget` into `ClaudeAdapter.execute()` are the review gate, the
reviewer-override overlay (`AGENT_VALIDATOR_REVIEWER_EFFORT` becomes `thinking_budget`), the eval
adapter runner (`evals/adapter-runner.ts`), and the eval judge (`evals/judge.ts`). They all get the
new behavior without any changes.

## Goals / Non-Goals

**Goals:**
- Apply `thinking_budget` `low`, `medium`, and `high` as the Claude Code effort level, together with
  the existing `MAX_THINKING_TOKENS`.
- Keep `off` and an unset budget behaving exactly as they do today.
- Record the effort in the child's environment as the launch-resolved effort for Claude, on both
  success and failure paths. Never record it as observed.
- Keep reviews working on Claude Code versions that have no effort support.

**Non-Goals:**
- New config values (`xhigh`, `max`) or new config keys.
- Changes to other adapters' mappings or telemetry.
- Detecting the model or CLI version, or warning when `off` cannot disable thinking.

## Approach

### 1. Mapping table

Add the following to `src/cli-adapters/thinking-budget.ts`, next to `CLAUDE_THINKING_TOKENS`:

```ts
/** Maps unified thinking budget levels to Claude Code effort levels (CLAUDE_CODE_EFFORT_LEVEL). `off` has no effort. */
export const CLAUDE_EFFORT_LEVEL: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};
```

### 2. One pure resolver for the launch environment and resolved effort

Add `resolveClaudeThinkingLaunch(thinkingBudget, parentEnv)` to `src/cli-adapters/claude.ts`, or to
`thinking-budget.ts` if it reads more cleanly there. It returns:

```ts
{ env: Record<string, string>; resolvedEffort: string | null }
```

- `env` holds `MAX_THINKING_TOKENS` when the budget is in `CLAUDE_THINKING_TOKENS`. It also holds
  `CLAUDE_CODE_EFFORT_LEVEL` when the budget is in `CLAUDE_EFFORT_LEVEL`.
- `resolvedEffort` is the value the child will actually see:
  - It is the mapped level when the adapter sets one.
  - Otherwise, it comes from `parentEnv.CLAUDE_CODE_EFFORT_LEVEL`, but only when the raw value,
    lowercased and **not trimmed**, exactly matches one of `low`, `medium`, `high`, `xhigh`, or `max`.
    It is then recorded in that canonical lowercase form. This follows the Claude Code 2.1.284 parser,
    which lowercases without trimming, so `" medium "` is not a level to Claude Code.
  - Otherwise it is `null`. This covers:
    - an absent or empty variable;
    - `auto` and `unset` (no override in Claude Code);
    - values with surrounding whitespace;
    - unknown strings;
    - values Claude Code may parse through version-specific aliases or numeric forms (for example,
      `med` or `3`).

    Aliases and numeric forms are left unavailable rather than guessed, because those parsing rules
    are internal to Claude Code and may change between versions. `null` means "not established", not
    "Claude used its default".
- The inherited value is never rewritten. The child receives exactly what the parent environment
  held.

The child environment is `{ ...parentEnv, ...otelEnv, ...env }`, where `parentEnv` is the single
snapshot described in §3. As a result:

- A configured effort overwrites an inherited `CLAUDE_CODE_EFFORT_LEVEL`.
- When the adapter sets nothing (`off` or unset budget), the inherited value passes through unchanged.

### 3. Resolve once in `execute()`, thread the result through

`execute()` takes one snapshot of the parent environment: `const { CLAUDECODE: _, ...parentEnv } =
process.env`, copied into a new object. It then passes that same snapshot to both places:

- It passes it to the resolver, which returns `env` and `resolvedEffort`.
- It passes it to `doExecute()`, together with `env` and `resolvedEffort`.

`doExecute()` builds the child environment from that snapshot. It no longer reads `process.env` for
the spawn, and it no longer builds `thinkingEnv` inline. `execute()` also passes `resolvedEffort` into
the baseline telemetry.

- *Consistency:* `doExecute()` awaits file creation before it spawns. Because the snapshot is taken
  once, a concurrent change to `process.env` during that gap can no longer make the recorded
  inherited effort differ from what the child receives.
- *Failure path:* because the resolver runs before the subprocess, a failure or timeout still records
  the correct launch-resolved effort.

### 4. Telemetry: a separate resolved effort

- `createUnavailableTelemetry` (in `shared.ts`) gets an optional `resolvedEffort?: string | null`.
  When `resolvedEffort` is provided (including as `null`), `resolved_identity.effort` uses it.
  Otherwise the field falls back to `requestedEffort`, which is today's behavior. This keeps every
  other adapter unchanged.
- The `claude-otel.ts` option type `{ requestedModel?, thinkingBudget? }` gains
  `resolvedEffort?: string | null`. `createClaudeTelemetry` forwards it. `ClaudeAdapter` passes it to
  both the streaming collector and the final `parseClaudeOtelTelemetry` calls.
- `requested_identity.effort` stays equal to the configured `thinking_budget`, including `off`.
- No observed identity gets an effort, because the Claude OTel stream does not report effort.

### 5. Data flow

```
process.env ──► parentEnv snapshot (minus CLAUDECODE), taken once in execute()
thinking_budget ──► resolveClaudeThinkingLaunch(budget, parentEnv)
                        │ env { MAX_THINKING_TOKENS?, CLAUDE_CODE_EFFORT_LEVEL? }
                        │ resolvedEffort
                        ▼
execute(): baseline telemetry (requested=budget, resolved=resolvedEffort)
   └► doExecute(): spawn claude with {...parentEnv, ...otelEnv, ...env}
                   collector/parser telemetry (requested=budget, resolved=resolvedEffort)
```

### 6. Documentation

- `docs/cli-invocation-details.md` (Claude Code section): state that `thinking_budget` sets
  `MAX_THINKING_TOKENS` and, for `low`, `medium`, and `high`, `CLAUDE_CODE_EFFORT_LEVEL`. State that
  `off` sets only `MAX_THINKING_TOKENS=0` and cannot disable thinking on models that always think
  (for example, Sonnet 5.5 and Opus 5.5). State that an unset budget leaves inherited values
  untouched. State that a managed `maxEffortLevel` can cap the effort.
- `docs/config-reference.md` and `docs/reviews-and-adapters.md`: add a short note to the
  `thinking_budget` rows that says:
  - Levels are adapter-specific settings, not calibrated equivalents across adapters.
  - For Claude, `thinking_budget` now controls effort.

## Decisions

- **Use the `CLAUDE_CODE_EFFORT_LEVEL` environment variable, not the `--effort` flag.** This
  completes the spec's two `deferred-to-design` scenarios.
  - *Precedence:* the environment variable overrides both the `/effort` command and a saved
    `effortLevel` setting, so it gives the precedence the spec requires.
  - *Older CLIs:* versions of Claude Code without effort support ignore an unknown environment
    variable, so reviews keep running. An unknown `--effort` flag would make every Claude review
    fail.
  - *Consistency:* the variable matches the adapter's existing environment-based thinking control.
  - *Cost:* the effort doesn't appear in logged CLI arguments. Recording it as the launch-resolved
    effort in telemetry makes up for that.
- **Keep `MAX_THINKING_TOKENS` for `low`, `medium`, and `high`.** Models without adaptive thinking
  still use it, and adaptive models ignore a positive value.
- **An inherited value counts as resolved effort only when it is an exact canonical level.** The
  match is case-insensitive and untrimmed: `low`, `medium`, `high`, `xhigh`, or `max`. Claude Code
  treats `auto` and `unset` as no override, ignores values with whitespace, and handles aliases and
  numeric values through version-specific rules. All of these are recorded as `null`. The
  alternative, a separate raw-value telemetry field, was rejected because it would add a field to the
  persisted telemetry format for a rare edge case.
- **Snapshot the environment once and resolve once, before telemetry and spawn.** A single parent
  environment snapshot feeds a single pure function. That keeps the child environment and the recorded
  resolved effort consistent even if `process.env` changes concurrently. It also covers the failure
  path and is easy to unit test.
- **Add `resolvedEffort` as an optional override in `createUnavailableTelemetry`.** Other adapters
  are unaffected. The fallback preserves the current output for every adapter except Claude.

## Risks / Trade-offs

- **Behavior change for existing Claude configs.** For example, the `init` default of `high` and any
  `low` configs will now actually change cost, latency, and review depth. This is intended (D6).
  - *Mitigation:* the changelog and documentation notes will call it out.
- **A future Claude Code version could rename or drop the variable.** The effort setting would then
  silently stop applying, and reviews would still run.
  - *Mitigation:* a unit test pins the variable name, and the documentation names the dependency.
    Behavior would fall back to today's.
- **A managed `maxEffortLevel` or lack of model support can make the applied effort lower than the
  resolved effort.** This is accepted and documented. Telemetry never claims observed effort.
- **The eval judge's effort changes.** A judge configured with `thinking_budget: high` now also gets
  effort `high`. This matches what the configuration asks for. Existing eval baselines were recorded
  without it, and re-running them is out of scope.

## Testing

- **Unit tests for the mapping** in `test/cli-adapters/adapter-config.test.ts`: `CLAUDE_EFFORT_LEVEL`
  maps `low`, `medium`, and `high` one-to-one and has no `off` entry.
- **Unit tests for the resolver**, one per case:
  - Each of `low`, `medium`, and `high` sets both variables.
  - `off` sets only `MAX_THINKING_TOKENS=0`.
  - An unset budget returns an empty environment.
  - A configured budget overrides an inherited effort.
  - An inherited `medium` with an unset budget resolves to `medium`.
  - An inherited `auto`, `unset`, or unrecognized value resolves to `null`.
  - An inherited `MEDIUM` resolves to `medium`. Inherited `" medium "`, `med`, and `3` resolve to
    `null`, and the child still receives the raw value unchanged.
  - An inherited effort with `off` resolves to the inherited value.
- **Adapter-level tests** that stub the spawn and capture the child environment:
  - A change to `process.env.CLAUDE_CODE_EFFORT_LEVEL` after `execute()` has started (for example,
    during file creation) is not seen by the child. The captured child value matches
    `resolved_identity.effort`.
  - `CLAUDE_CODE_EFFORT_LEVEL` and `MAX_THINKING_TOKENS` are present or absent as specified.
  - An inherited `CLAUDE_CODE_EFFORT_LEVEL` reaches the child when the budget is unset.
- **Telemetry tests** in `test/cli-adapters/native-telemetry.test.ts`:
  - The requested and resolved effort values match the spec scenarios for `high`, `off`, and an unset
    budget with inherited `medium`.
  - A failure path leaves resolved effort at `low` for `thinking_budget: low`.
  - The telemetry output for other adapters is unchanged.

## Migration Plan

No data or configuration migration is needed. Rollback is a code revert: configurations remain valid,
and Claude reverts to token-budget-only control.
