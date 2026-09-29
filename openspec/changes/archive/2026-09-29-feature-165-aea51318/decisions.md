# Decisions — feature-165-aea51318

## Step: propose

### D1. Verdict: go
- **Decision:** Go. The Claude Code CLI 2.1.284 supports effort through `--effort` and `CLAUDE_CODE_EFFORT_LEVEL`, so the issue's "if possible" condition is met.
- **Alternatives considered:** No-go (effort not available). Rejected: a local probe confirmed that the flag is accepted for Sonnet and Haiku.
- **Decision-bearing:** yes

### D2. Keep the existing `thinking_budget` enum and add no new config key
- **Decision:** Reuse `thinking_budget` (`off|low|medium|high`) as the source for Claude effort. Add no `effort` key and no `xhigh`/`max` values.
- **Alternatives considered:** A new `effort` config field for each adapter. Extending the enum with `xhigh`/`max`. Both change the public config interface and go beyond the issue.
- **Decision-bearing:** yes

### D3. `off` sets no effort level
- **Decision:** `off` keeps `MAX_THINKING_TOKENS=0` and passes no effort. `low`, `medium`, and `high` pass the same value as the effort.
- **Alternatives considered:** Mapping `off` to `low` effort. Rejected: effort cannot express "no thinking", and the reviewer-override spec already treats effort as unable to express `off`.
- **Decision-bearing:** yes

### D4. Keep `MAX_THINKING_TOKENS` alongside effort
- **Decision:** Keep setting `MAX_THINKING_TOKENS` for `low`, `medium`, and `high`, in addition to effort.
- **Alternatives considered:** Replacing it with effort only. Rejected: models without adaptive thinking (for example, Haiku) still honor the token budget.
- **Decision-bearing:** no (a low-risk default)

### D5. Recommend the `CLAUDE_CODE_EFFORT_LEVEL` environment variable over the `--effort` flag
- **Decision:** Recommend the environment variable, because older Claude Code versions ignore it instead of failing on an unknown flag. It is also consistent with the adapter's existing environment-based thinking control. The design step confirms precedence.
- **Alternatives considered:** The `--effort` flag, which is more visible and matches Copilot, but hard-fails on older CLIs.
- **Decision-bearing:** no (an implementation detail; design may revisit it)

### D6. The behavior change for existing Claude configs is acceptable
- **Decision:** Treat the fact that `thinking_budget` now actually changes Claude's effort as the intended fix, not a breaking change. The schema and persisted formats are unchanged.
- **Alternatives considered:** Putting it behind an opt-in flag. Rejected: this would keep the misleading no-op as the default.
- **Decision-bearing:** yes

## Step: proposal review (proposal-review-findings.json)

### PR-1. `off` cannot disable thinking on some models: applied in part
- **Decision:** Applied. The proposal no longer calls `MAX_THINKING_TOKENS=0` a guaranteed thinking-off. It states that some models (for example, Sonnet 5.5 and Opus 5.5) cannot have thinking turned off, and that the `review-config` contract and docs will say `off` disables thinking only where the model supports it. The proposal also no longer says adaptive models "honor 0". Rejected: the suggested runtime warning or unsupported-setting result for known models. It would need a hand-maintained list of model IDs and aliases (`sonnet` and `opus` resolve to different models over time, and an omitted model can't be classified). It would go beyond the issue, and it would change behavior that is identical to today's.
- **Alternatives considered:** A warning based on a known-model list (rejected: brittle and out of scope). Mapping `off` to `low` effort on such models (rejected: it silently substitutes a different setting).
- **Decision-bearing:** yes

### PR-2. Resolved effort is not observed effort: applied
- **Decision:** Applied. For Claude, the launch-resolved effort (`launch_resolution` provenance) is the value in the child environment: the mapped level, or an inherited `CLAUDE_CODE_EFFORT_LEVEL` when the adapter sets none, or `null`. The requested identity keeps the configured budget. The observed effort stays unavailable. The proposal documents that model support and managed `maxEffortLevel` caps (confirmed in the Claude Code 2.1.284 binary) can make the actual effort differ. The existing `validation-metrics` provenance rules are followed, not modified.
- **Alternatives considered:** Keep copying the requested budget into the resolved effort (rejected: it mislabels `off` and ignores inherited or overridden values). Strip an inherited `CLAUDE_CODE_EFFORT_LEVEL` when no budget is set (rejected: the unset case means "no override", which is today's behavior).
- **Decision-bearing:** yes

### PR-3. Matching level names are not calibrated equivalence: applied
- **Decision:** Applied. The Why and Impact sections now describe the benefit as faithfully applying the configured level and labeling eval conditions accurately. Matching levels across adapters is described explicitly as an experimental control, and like-for-like claims must rest on measured cost, latency, and outcomes.
- **Alternatives considered:** None. The finding corrects an overclaim and does not change scope.
- **Decision-bearing:** no

## Step: spec

### S1. Put all spec deltas in `review-config`
- **Decision:** Modify the "Adapter Thinking Budget Level Mapping" requirement, copying the full block and adding the Claude effort scenarios. Add a new "Claude Launch-Resolved Effort Identity" requirement in the same capability. `validation-metrics` is not modified: its generic provenance rule already governs, and the new requirement applies that rule to Claude.
- **Alternatives considered:** Adding a Claude-specific requirement to `validation-metrics`. Rejected: the proposal lists only `review-config`, and the metrics spec is adapter-neutral.
- **Decision-bearing:** no

### S2. Configured effort overrides an inherited `CLAUDE_CODE_EFFORT_LEVEL`, and an unset budget passes inherited values through
- **Decision:** When `thinking_budget` is set, the adapter's effort wins over an inherited `CLAUDE_CODE_EFFORT_LEVEL`. When it is unset, the adapter sets nothing and inherited values pass through unchanged. With `off`, the adapter sets no effort, so an inherited effort also passes through.
- **Alternatives considered:** Stripping an inherited effort for `off` or for an unset budget. Rejected: this changes today's "no override" behavior and needs a direction the issue doesn't give.
- **Decision-bearing:** yes

### S3. Mechanism-dependent scenarios deferred to design
- **Decision:** The scenario for the effort mechanism and the scenario for old CLIs without effort support carry `deferred-to-design` markers. The spec requires that a review still runs on a Claude Code version without effort support, which favors the environment variable (D5).
- **Alternatives considered:** Fixing the mechanism in the spec. Rejected: that is an architectural choice.
- **Decision-bearing:** no

### S4. Resolved effort on the failure path
- **Decision:** When execution fails before telemetry is collected, the launch-resolved effort is still recorded. This matches the existing failure-path telemetry baseline.
- **Alternatives considered:** Leaving the resolved effort unavailable on failure. Rejected: the launch value is known independently of the outcome.
- **Decision-bearing:** no

## Step: design

### DS1. The effort mechanism is `CLAUDE_CODE_EFFORT_LEVEL` (this confirms D5)
- **Decision:** Pass effort through the `CLAUDE_CODE_EFFORT_LEVEL` environment variable. Claude Code 2.1.284 makes this variable override both the `/effort` command and the saved `effortLevel` setting, and older CLIs ignore it. The spec's deferred scenarios are now concrete: the effort is set through the environment variable, and there is no `--effort` argument.
- **Alternatives considered:** The `--effort` flag, which is visible in the arguments but fails on older CLIs. Setting both the flag and the variable (rejected: this has the same failure risk).
- **Decision-bearing:** yes

### DS2. An inherited effort counts only as a recognized level
- **Decision:** An inherited `CLAUDE_CODE_EFFORT_LEVEL` is reported as the resolved effort only when it is `low`, `medium`, `high`, `xhigh`, or `max` after trimming and lowercasing. `auto`, `unset`, and unrecognized values resolve to `null`, because Claude Code treats them as "no override". This refinement and a matching scenario were added to the spec.
- **Alternatives considered:** Recording the raw inherited string. Rejected: it would report `auto` as a launch effort.
- **Decision-bearing:** no

### DS3. Resolve once, before the baseline telemetry and the spawn
- **Decision:** A pure resolver runs in `execute()` and returns the child's environment variables and the resolved effort. The same values feed the baseline, streaming, and final telemetry, and the spawn.
- **Alternatives considered:** Computing the effort inside `doExecute` and the OTel parser separately. Rejected: the failure-path baseline would miss it, and the logic would be duplicated.
- **Decision-bearing:** no

### DS4. `createUnavailableTelemetry` gains an optional `resolvedEffort`
- **Decision:** Add an optional `resolvedEffort` override that falls back to `requestedEffort`, so the telemetry output for other adapters is unchanged.
- **Alternatives considered:** Overwriting `resolved_identity.effort` after construction inside the Claude modules. Rejected: it is easier to get wrong and there are three call sites.
- **Decision-bearing:** no

## Step: test plan

### T1. Integration against a fake `claude` executable instead of module mocks
- **Decision:** INT-001 drives the real `ClaudeAdapter.execute()` against a fake `claude` on `PATH`. The fake records its environment and argv, and it rejects `--effort` to mimic an older CLI. `process.env` is saved and restored around each test, as `test/AGENTS.md` requires.
- **Alternatives considered:** Unit tests that stub `streamCommand`. Rejected as the only coverage: they would not prove that the variable reaches a real child process or stays off the argv.
- **Decision-bearing:** no

### T2. Two E2E journeys through the built CLI using the existing stub harness
- **Decision:** E2E-001 covers config → Claude environment. E2E-002 covers reviewer override → Claude environment. Both extend `createReviewerOverrideStubs` so the Claude stub records the effort and token variables.
- **Alternatives considered:** Checking the recorded metrics in E2E. Rejected: telemetry identity is fully covered by INT-001, so E2E adds cost without extra confidence.
- **Decision-bearing:** no

### T3. Acceptance may use the real Claude CLI with a bounded budget
- **Decision:** Allow up to about 10 small real `claude -p` runs with the user's existing login. Editing the user's or managed Claude settings is forbidden. A fake CLI is permitted as a substitute. Human-only testing: none.
- **Alternatives considered:** Forbidding paid calls entirely. Rejected: one cheap real run confirms that the CLI accepts the variable.
- **Decision-bearing:** yes

## Step: approach review (approach-review-findings.json)

### AR-1. Inherited-effort normalization must follow Claude Code's parser: applied (this replaces the DS2 normalization)
- **Decision:** Applied. The binary check confirmed the finding: the 2.1.284 parser lowercases without trimming, maps aliases, and accepts numeric values. An inherited `CLAUDE_CODE_EFFORT_LEVEL` now counts as resolved effort only when the raw value, compared case-insensitively and untrimmed, is exactly `low`, `medium`, `high`, `xhigh`, or `max`. It is recorded in canonical lowercase. Values with whitespace, aliases (`med`), numeric values, `auto`, `unset`, and unknown strings resolve to `null`, meaning "not established". The inherited value always reaches the child unchanged. The spec, design, and test plan were updated, with new scenarios for whitespace and aliases and for uppercase canonical values. Rejected part: retaining the raw launch value in a separate telemetry field. It would extend the persisted telemetry identity format for a rare edge case, and `null` already avoids a false claim.
- **Alternatives considered:** Mirroring Claude Code's alias and numeric table (rejected: those rules are version-specific internals). Recording a raw-value field (rejected: format change).
- **Decision-bearing:** no

### AR-2. A single parent-environment snapshot feeds both the resolver and the spawn: applied
- **Decision:** Applied. `execute()` takes one snapshot of `process.env` with `CLAUDECODE` removed. It passes that snapshot to the resolver and to `doExecute()`, which builds the child environment from it instead of reading `process.env` again after the file-write await. The spec now requires the resolved effort and the child environment to come from the same snapshot. INT-001 adds a case that changes `process.env` mid-execution and checks that the child's value matches `resolved_identity.effort`.
- **Alternatives considered:** Reading `process.env` twice and accepting the race (rejected: it breaks the consistency the design claims).
- **Decision-bearing:** no

## Step: tasks

### TK1. A single implementation task for the whole change
- **Decision:** `tasks.md` lists exactly one task, `tasks/claude-reasoning-effort.md`, as instructed. The task covers the mapping, the resolver, the environment snapshot, the telemetry plumbing, the documentation, the unit tests, INT-001, and E2E-001 and E2E-002. The per-task file follows the repository's `tasks.md` + `tasks/*.md` convention.
- **Alternatives considered:** Splitting the work into separate adapter, telemetry, and tests tasks. Rejected: the instruction requires one task, and the change is small.
- **Decision-bearing:** no

### TK2. A separate env capture file for the E2E Claude stub; no manual changelog
- **Decision:** Extend the Claude stub in `createReviewerOverrideStubs` with a separate env capture file, so existing assertions on the argv capture (`toBe("")`) keep working. Do not edit `CHANGELOG.md` or add a `.changeset` file by hand, because the repository generates changesets at release time.
- **Alternatives considered:** Appending env data to the existing argv capture (rejected: it would break existing tests).
- **Decision-bearing:** no
