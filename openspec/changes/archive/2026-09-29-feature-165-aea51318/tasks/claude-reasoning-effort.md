# Task: Claude adapter reasoning effort

## Goal

Make `thinking_budget` actually control Claude's reasoning effort. For `low`, `medium`, and `high`,
the Claude adapter sets the `CLAUDE_CODE_EFFORT_LEVEL` environment variable on the spawned `claude`
process, in addition to the existing `MAX_THINKING_TOKENS`. Claude telemetry must record the effort
the process was actually launched with as the launch-resolved effort.

Today, current Claude models such as Sonnet 5.5 ignore a positive `MAX_THINKING_TOKENS`, so
`thinking_budget: low`, `medium`, and `high` all run at Claude Code's default effort (GitHub issue #165).

## Background

Read these first: `openspec/changes/archive/2026-09-29-feature-165-aea51318/proposal.md`, `design.md`,
`specs/review-config/spec.md`, and `test-plan.md`. `decisions.md` records why each choice was made.

### Current code

- `src/cli-adapters/thinking-budget.ts` holds the per-adapter maps. `CLAUDE_THINKING_TOKENS` maps
  `off`/`low`/`medium`/`high` to `0`/`8000`/`16000`/`31999`.
- In `src/cli-adapters/claude.ts`:
  - `ClaudeAdapter.execute()` builds baseline telemetry with
    `createUnavailableTelemetry('claude', { requestedModel, requestedEffort: opts.thinkingBudget })`.
    This baseline is what an `AdapterExecutionFailure` carries if execution throws. `execute()` then
    calls `doExecute()`.
  - `doExecute()` does the following, in order:
    1. It awaits `fs.writeFile` of the prompt temp file.
    2. It builds the args (`-p`, `--allowedTools`, `--max-turns`, optional `--model`).
    3. It builds `thinkingEnv` with only `MAX_THINKING_TOKENS`.
    4. It builds `execEnv = { ...parentEnv, ...otelEnv, ...thinkingEnv }`, where `parentEnv` is
       `process.env` minus `CLAUDECODE`.
    5. It calls `createClaudeTelemetryCollector(...)` and `parseClaudeOtelTelemetry(...)` with
       `{ requestedModel, thinkingBudget }`.
- `src/cli-adapters/claude-otel.ts`: `createClaudeTelemetry` calls `createUnavailableTelemetry` with
  `requestedEffort: opts.thinkingBudget`. The option types are
  `{ requestedModel?: string; thinkingBudget?: string }`.
- `src/cli-adapters/shared.ts`: `createUnavailableTelemetry` copies `requestedEffort` into both
  `requested_identity.effort` (provenance `configuration`) and `resolved_identity.effort` (provenance
  `launch_resolution`).
- Callers need no changes, because they already pass `thinkingBudget` into `execute()`:
  - the review gate;
  - the reviewer-override overlay (`AGENT_VALIDATOR_REVIEWER_EFFORT` → `thinking_budget`);
  - `evals/adapter-runner.ts`;
  - `evals/judge.ts`.

### Claude Code facts (verified in the installed 2.1.284 binary)

- `CLAUDE_CODE_EFFORT_LEVEL` overrides both the `/effort` command and the saved `effortLevel`
  setting.
- The parser lowercases the value but does **not** trim it. It treats `auto` and `unset` as "no
  override", and it also accepts version-specific aliases (such as `med`) and numeric values.
- The canonical levels are `low`, `medium`, `high`, `xhigh`, and `max`.
- Older Claude Code versions ignore the variable. Do **not** use the `--effort` flag: older versions
  reject unknown flags, which would make every Claude review fail.
- A managed `maxEffortLevel` can cap the effort, and Claude Code does not report the effort it applied.

## What to implement

1. **Mapping.** Add to `src/cli-adapters/thinking-budget.ts`:

   ```ts
   /** Maps unified thinking budget levels to Claude Code effort levels (CLAUDE_CODE_EFFORT_LEVEL). `off` has no effort. */
   export const CLAUDE_EFFORT_LEVEL: Record<string, string> = { low: 'low', medium: 'medium', high: 'high' };
   ```

2. **Pure resolver.** Add
   `resolveClaudeThinkingLaunch(thinkingBudget: string | undefined, parentEnv: Record<string, string | undefined>)`,
   placed in `claude.ts` or `thinking-budget.ts`. It returns
   `{ env: Record<string, string>; resolvedEffort: string | null }`.
   - `env.MAX_THINKING_TOKENS` is set when the budget is in `CLAUDE_THINKING_TOKENS`.
   - `env.CLAUDE_CODE_EFFORT_LEVEL` is set when the budget is in `CLAUDE_EFFORT_LEVEL`.
   - `resolvedEffort` is the first of these that applies:
     1. the mapped level, when one is set;
     2. otherwise, when `parentEnv.CLAUDE_CODE_EFFORT_LEVEL` lowercased (**not trimmed**) is exactly
        `low`, `medium`, `high`, `xhigh`, or `max`, that lowercase value;
     3. otherwise `null`. This covers an absent or empty value, `auto`, `unset`, whitespace-padded
        values, aliases, numeric values, and unknown strings.
   - Never rewrite the inherited value.

3. **One environment snapshot.** In `execute()`:
   - Take the snapshot **synchronously, before any `await`**:
     `const { CLAUDECODE: _, ...parentEnv } = process.env` (a new object).
   - Call the resolver with that snapshot.
   - Pass `resolvedEffort` into the baseline `createUnavailableTelemetry` call.
   - Pass `parentEnv`, the resolver's `env`, and `resolvedEffort` into `doExecute()`.

   In `doExecute()`:
   - Build `execEnv = { ...parentEnv, ...otelEnv, ...env }` from those parameters.
   - Remove the inline `thinkingEnv` construction and the second read of `process.env`.

   A configured effort therefore overwrites an inherited one. With `off` or an unset budget, the
   inherited value passes through untouched.

4. **Telemetry.**
   - In `shared.ts`, add an optional `resolvedEffort?: string | null` to `createUnavailableTelemetry`.
     When the key is provided (even as `null`), `resolved_identity.effort` uses it. Otherwise it keeps
     today's fallback to `requestedEffort`, so other adapters' output stays byte-identical.
   - In `claude-otel.ts`:
     - Add `resolvedEffort?: string | null` to the option types of `parseClaudeOtelTelemetry`,
       `createClaudeTelemetry`, and `createClaudeTelemetryCollector`.
     - Forward it to `createUnavailableTelemetry`.
   - In `claude.ts`, pass `resolvedEffort` to the collector and to both `parseClaudeOtelTelemetry`
     calls.
   - `requested_identity.effort` stays equal to the configured `thinking_budget`, including `off`, or
     `null` when there is none. Never put an effort in any observed identity.

5. **Documentation.**
   - `docs/cli-invocation-details.md`, Claude Code section. Add bullets saying:
     - `thinking_budget` sets `MAX_THINKING_TOKENS`, and for `low`, `medium`, and `high` also
       `CLAUDE_CODE_EFFORT_LEVEL`.
     - `off` sets only `MAX_THINKING_TOKENS=0` and cannot disable thinking on models that always think
       (for example, Sonnet 5.5 and Opus 5.5).
     - An unset budget leaves inherited `CLAUDE_CODE_EFFORT_LEVEL` and `MAX_THINKING_TOKENS`
       untouched.
     - A managed `maxEffortLevel` can cap effort.
   - `docs/config-reference.md` and `docs/reviews-and-adapters.md`: next to the `thinking_budget` rows,
     note that levels are adapter-specific settings, not calibrated equivalents across adapters, and
     that for Claude they also set the Claude Code effort level.
   - Do not hand-edit `CHANGELOG.md` or add a `.changeset` file. Changesets are generated at release
     time.

## Tests

Follow `test/AGENTS.md`: never use `mock.module()` on shared modules. Save and restore `process.env`
around every test that changes it.

- **Unit tests.**
  - In `test/cli-adapters/adapter-config.test.ts`:
    - `CLAUDE_EFFORT_LEVEL` maps `low`, `medium`, and `high` one-to-one and has no `off` key.
    - The resolver handles every case: `low`, `medium`, and `high` set both variables; `off` sets only
      `MAX_THINKING_TOKENS=0`; an unset budget returns an empty `env`; a configured budget beats an
      inherited value; inherited `medium` resolves to `medium`; `MEDIUM` resolves to `medium`; `auto`,
      `unset`, `" medium "`, `med`, `3`, and `bogus` resolve to `null`; `off` with inherited `high`
      resolves to `high`.
  - `createUnavailableTelemetry`: an explicit `resolvedEffort: null` gives a resolved effort of `null`,
    and omitting it keeps the `requestedEffort` fallback.
- **INT-001** (`test/cli-adapters/claude-effort.test.ts`). Implement exactly as `test-plan.md` §INT-001
  describes.
  - Setup:
    - Put a fake `claude` Node script in a temporary bin directory prepended to `PATH`.
    - The script appends a JSON record of its argv, `CLAUDE_CODE_EFFORT_LEVEL`, and
      `MAX_THINKING_TOKENS` (use `null` when absent) to a capture file, then prints passing review
      JSON.
    - It exits non-zero with "unknown option" if it sees `--effort`.
    - An environment switch makes it exit non-zero, to exercise the failure path.
  - Cover each case:
    - Each budget level, `off`, and an unset budget.
    - Inherited values `medium`, `MEDIUM`, `auto`, `" medium "`, and `med` with an unset budget.
    - `low` with an inherited `high`.
    - The failure mode with `low`. Assert that the `AdapterExecutionFailure` telemetry has resolved
      effort `low`.
    - The concurrent case: call `const p = adapter.execute(...)`, then set
      `process.env.CLAUDE_CODE_EFFORT_LEVEL = 'high'` before `await p`. Assert that the child
      received the originally inherited `medium` and that `resolved_identity.effort` is `medium`.
  - Assert:
    - The captured child values match the telemetry.
    - Inherited values reach the child byte-for-byte.
    - `--effort` never appears in argv.
    - The requested and resolved identity values and the `launch_resolution` provenance are as the
      spec requires.
- **E2E-001 and E2E-002** (`test/integration/`, run by `bun run test:e2e`).
  - Stub setup: extend `createReviewerOverrideStubs` in `test/integration/helpers.ts` so the Claude
    stub **also** writes `CLAUDE_CODE_EFFORT_LEVEL` and `MAX_THINKING_TOKENS` to a **separate** capture
    file. Expose it through a new reader, such as `readClaudeEnv()`. Keep the existing argv capture
    file unchanged, because existing tests assert on it (`toBe("")` and `not.toBe("")`).
  - In both tests, make sure the parent environment has no `CLAUDE_CODE_EFFORT_LEVEL`.
  - E2E-001: the project config sets `cli.adapters.claude.thinking_budget: low` and prefers
    `claude`. `node dist/index.js run` succeeds, and the stub recorded `CLAUDE_CODE_EFFORT_LEVEL=low`,
    `MAX_THINKING_TOKENS=8000`, and no `--effort`.
  - E2E-002: the project reviewer is not Claude. Running with `AGENT_VALIDATOR_REVIEWER_CLI=claude`
    and `AGENT_VALIDATOR_REVIEWER_EFFORT=medium` succeeds, and the stub recorded
    `CLAUDE_CODE_EFFORT_LEVEL=medium` and `MAX_THINKING_TOKENS=16000`.

## Out of scope

- Adding `xhigh` or `max` to the `thinking_budget` schema, or changing how reviewer-override
  collapses `xhigh` to `high`.
- Changing mappings or telemetry for Codex, Gemini, Cursor, Copilot, or OpenCode.
- Changing the `init` default for Claude (`high`).
- Warning about models whose thinking cannot be turned off.
- Detecting the Claude Code version.
- Adding a raw inherited-effort telemetry field.
- Re-running evals.

## Done When

- Every scenario in `openspec/changes/archive/2026-09-29-feature-165-aea51318/specs/review-config/spec.md` is satisfied.
  That covers "Adapter Thinking Budget Level Mapping" (including the unchanged Codex and Gemini
  scenarios) and "Claude Launch-Resolved Effort Identity".
- The unit tests, INT-001, E2E-001, and E2E-002 exist and pass.
- `bun run test` passes, `bun run test:e2e` passes, and Biome lint/format is clean.
- Telemetry output for non-Claude adapters is unchanged, and existing telemetry tests pass unmodified.
- The three documentation files are updated as described.
- The validator passes on the change: run `bun run build:npm && node dist/index.js run`.
