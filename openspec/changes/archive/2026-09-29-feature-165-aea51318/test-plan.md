## Coverage Strategy

The specifications remain the source of unit-test requirements. This plan records only the additional
integration and end-to-end obligations, the acceptance testing envelope, and exceptional human-only
obligations.

Unit tests (not inventoried here) cover the following:

- The `CLAUDE_EFFORT_LEVEL` mapping table.
- The pure launch resolver. Its cases are the budget levels, `off`, an unset budget, an overridden
  inherited value, and inherited values that are recognized, `auto`/`unset`, or unrecognized.
- The `resolvedEffort` override and fallback in `createUnavailableTelemetry`.
- The Claude OTel telemetry builders.

The extra layers below exist because the main risk is in the wiring, not the mapping logic. The
settings must reach a real child process through its environment, stay off its argument list, and
match the recorded telemetry. That must also hold on the failure path and through the public `run`
entry point, both for configured budgets and for the reviewer-override overlay.

## Integration Tests

### INT-001: Claude adapter launches a subprocess with the effort environment and matching telemetry
- Covers:
  - Adapter Thinking Budget Level Mapping. Scenarios: Claude effort applied for low, medium, and high;
    Claude off sets no effort level; Claude with no thinking budget applies no override; configured
    Claude effort overrides inherited effort; Claude CLI without effort support still runs.
  - Claude Launch-Resolved Effort Identity. Scenarios: mapped effort, off, inherited effort,
    unrecognized inherited effort, and failure retention.
- Boundary: the real `ClaudeAdapter.execute()` spawns a real executable named `claude` found on
  `PATH`, with the process environment and argument list built by the adapter. The resulting
  `AdapterTelemetry` is used, including the `AdapterExecutionFailure` telemetry on failure.
- Setup:
  - Create a temporary bin directory holding a fake `claude` Node script. The script appends a JSON
    record of its argv, `CLAUDE_CODE_EFFORT_LEVEL`, and `MAX_THINKING_TOKENS` (or `null` when absent)
    to a capture file, then prints a passing review JSON.
  - The fake exits non-zero with "unknown option" if it sees `--effort`. This mimics an older Claude
    Code and pins the requirement that reviews still run.
  - A variant mode, selected by an environment switch, exits non-zero to exercise the failure path.
  - Prepend the bin directory to `PATH` and set or delete a parent `CLAUDE_CODE_EFFORT_LEVEL` for each
    case. Save and restore `process.env` in `beforeEach` and `afterEach`, because Bun runs all test
    files in one process (see `test/AGENTS.md`). Do not use `mock.module()`.
- Action: call `execute()` in each of these cases:
  - `thinkingBudget` of `low`, `medium`, `high`, and `off`, and an unset budget.
  - An unset budget with each of these inherited values: `medium`, `MEDIUM`, `auto`, `" medium "`,
    and `med`.
  - An unset budget with an inherited `medium`, where the test changes
    `process.env.CLAUDE_CODE_EFFORT_LEVEL` to `high` right after `execute()` is called and before
    the spawn (while the file write is awaited).
  - `low` with an inherited value of `high`.
  - `low` in the failure mode.
- Assertions:
  - The captured environment matches the spec mapping. `CLAUDE_CODE_EFFORT_LEVEL` equals the level
    for `low`, `medium`, and `high`. It is absent for `off` and for an unset budget, unless it was
    inherited, in which case it is passed through unchanged.
  - A configured `low` beats an inherited `high`.
  - `MAX_THINKING_TOKENS` is `8000`, `16000`, `31999`, or `0` as mapped, and it is absent when the
    budget is unset.
  - The argv never contains `--effort`.
  - On success, telemetry has `requested_identity.effort` equal to the configured budget (or `null`).
    It has `resolved_identity.effort` equal to the captured launch value, or `null` for `off`, for no
    effort, and for an inherited `auto`, `" medium "`, or `med`. An inherited `MEDIUM` is recorded
    as `medium`. Its provenance is `launch_resolution`.
  - Inherited values reach the child byte-for-byte.
  - In the concurrent-change case, the child receives `medium`, and the resolved effort is `medium`.
    The two always match.
  - No observed identity carries an effort.
  - On failure, the thrown `AdapterExecutionFailure` telemetry still has resolved effort `low`.
- Execution: `test/cli-adapters/claude-effort.test.ts`, run by `bun run test`.

## End-to-End Tests

### E2E-001: A configured Claude thinking budget reaches the reviewer subprocess through `run`
- Covers: Adapter Thinking Budget Level Mapping, specifically configuration-to-runtime wiring for
  `cli.adapters.claude.thinking_budget`.
- Surface: the built CLI (`node dist/index.js run`).
- Setup:
  - Create a temporary git repo with a small diff.
  - Add a `.validator/config.yml` whose review uses `cli_preference: [claude]` and sets
    `cli.adapters.claude.thinking_budget: low`.
  - Put a stub `claude` on `PATH`. Extend `createReviewerOverrideStubs` in
    `test/integration/helpers.ts` so the Claude stub also records `CLAUDE_CODE_EFFORT_LEVEL` and
    `MAX_THINKING_TOKENS`.
  - Make sure the parent environment has no `CLAUDE_CODE_EFFORT_LEVEL`.
- Journey: run `agent-validator run` against the repo.
- Assertions:
  - The run exits successfully.
  - The stub recorded `CLAUDE_CODE_EFFORT_LEVEL=low` and `MAX_THINKING_TOKENS=8000`.
  - No `--effort` argument was recorded.
- Execution: `test/integration/reviewer-override-e2e.test.ts`, or a sibling `claude-effort-e2e.test.ts`
  that reuses the same helpers. Run by `bun run test:e2e`.

### E2E-002: A reviewer-override effort reaches Claude
- Covers: Adapter Thinking Budget Level Mapping, scenario "Reviewer override effort reaches Claude".
- Surface: the built CLI (`node dist/index.js run`) with the Agent Runner override variables.
- Setup: the same stub harness as E2E-001. The project config names a non-Claude reviewer and has no
  Claude `thinking_budget`.
- Journey: run `agent-validator run` with `AGENT_VALIDATOR_REVIEWER_CLI=claude` and
  `AGENT_VALIDATOR_REVIEWER_EFFORT=medium`.
- Assertions:
  - The run exits successfully.
  - The stub recorded `CLAUDE_CODE_EFFORT_LEVEL=medium` and `MAX_THINKING_TOKENS=16000`.
- Execution: `test/integration/reviewer-override-e2e.test.ts`, run by `bun run test:e2e`.

## Acceptance Testing Envelope

- **Environments and sandboxes:**
  - The local development machine with the repo checkout, built with `bun run build:npm` and invoked
    as `node dist/index.js`. Do not use an `agent-validator` found on `PATH`.
  - Throwaway git repositories under the OS temp directory.
  - The real Claude Code CLI (2.1.284 as of this plan) is installed and authenticated.
- **Credentials and secrets:**
  - The user's existing Claude Code login, used implicitly by `claude`.
  - No other credentials are needed, and none may be read, copied, or printed.
- **Authorized effects:**
  - A small number (up to about 10) of real `claude -p` review invocations on tiny diffs, preferably
    with `model: haiku` or `sonnet`. The cost is negligible subscription or API usage.
  - Temporary repositories, stub binaries, and capture files must be deleted afterward.
  - Setting `CLAUDE_CODE_EFFORT_LEVEL` in the environment of a single command is allowed.
- **Off limits:**
  - Editing `~/.claude/settings.json` or any managed or user Claude settings, such as `effortLevel`
    and `maxEffortLevel`.
  - Pushing, publishing, opening issues or PRs, and changing GitHub state.
  - Running the eval suite against paid providers.
  - Changing other adapters' installations.
- **Permitted substitutes:**
  - If the real `claude` is unavailable or unauthenticated, use a fake `claude` on `PATH` that
    records its environment and argv. This is the same approach as INT-001 and E2E-001.
  - Claude Code does not report the applied effort in its output. The pass may therefore treat the
    child's environment plus the recorded launch-resolved telemetry as the evidence, and it must not
    claim observed effort.
- **Known risk areas:**
  - Leakage from the parent environment. Validator is often run inside a Claude Code session, which may
    export `CLAUDE_CODE_EFFORT_LEVEL`. Check that a configured budget wins and that an unset budget
    passes the value through.
  - Failure and timeout paths, where the baseline telemetry is built before the spawn.
  - Accepted limitations:
    - `off` cannot disable thinking on Sonnet 5.5 or Opus 5.5.
    - A managed `maxEffortLevel` may cap the effort.
    - A positive `MAX_THINKING_TOKENS` is ignored on adaptive models.
    - Matching level names across adapters are not calibrated equivalents.
  - Behavior changes for the eval judge and for the existing Claude `thinking_budget` defaults
    (`init` writes `high`).
  - Documentation accuracy in `docs/cli-invocation-details.md`, `docs/config-reference.md`, and
    `docs/reviews-and-adapters.md`.

## Human-Only Testing

None.

## Coverage Map

| Requirement or journey | INT | E2E | HT |
| --- | --- | --- | --- |
| Adapter Thinking Budget Level Mapping: Claude effort for low, medium, and high | INT-001 | E2E-001 | — |
| Adapter Thinking Budget Level Mapping: Claude off and unset budget | INT-001 | — | — |
| Adapter Thinking Budget Level Mapping: configured effort overrides inherited effort | INT-001 | — | — |
| Adapter Thinking Budget Level Mapping: reviewer override effort reaches Claude | — | E2E-002 | — |
| Adapter Thinking Budget Level Mapping: Claude CLI without effort support still runs | INT-001 | — | — |
| Claude Launch-Resolved Effort Identity (all scenarios) | INT-001 | — | — |
