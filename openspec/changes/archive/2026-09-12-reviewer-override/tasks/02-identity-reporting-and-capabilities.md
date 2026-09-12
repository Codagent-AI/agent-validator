# Task: Configured-identity reporting and capabilities advertisement

## Goal

Make a reviewer override visible to the humans and orchestrators that consume Validator output, and
let a caller detect that this Validator understands the override before it launches a run.

Two outward-facing surfaces change. When a reviewer override is active, the stderr RESULTS SUMMARY
and `--report` stdout name the configured review identity, so a Runner profile that disagrees with
the tracked project file is never invisible. Separately, `agent-validator metrics capabilities`
advertises `reviewer_override.supported` so a caller can fail closed on version skew instead of
setting environment variables an older Validator would ignore.

## Background

### Reporting

Reviewer identity for reviews is normally owned by the tracked project file. Agent Validator now
accepts an inherited Runner reviewer triple through the environment variables
`AGENT_VALIDATOR_REVIEWER_CLI`, `AGENT_VALIDATOR_REVIEWER_MODEL`, and
`AGENT_VALIDATOR_REVIEWER_EFFORT`, translates it into Validator adapter vocabulary, and applies it as
an in-memory overlay on `run`, `review`, `health`, `list`, and `detect`. The tracked
`.validator/config.yml` is never rewritten. That means the reviewers named in the repo file can
differ from the reviewers that actually ran, with nothing on disk explaining the difference. Naming
the configured identity in the run output is what makes that honest.

The override parse lives in `src/config/reviewer-override.ts` and its result is attached to
`LoadedConfig` (in `src/config/types.ts`) by `loadConfig` when the overlay is applied. Read that
attached identity. Do not re-read the environment at report time: `list` and `health` share the same
parse result, and a second read could disagree with what was actually overlaid.

The identity is source `runner-reviewer-role`, the mapped adapter, and, when the Runner effort
`xhigh` was collapsed to Validator `thinking_budget: high`, that collapse. It is the requested and
configured identity, not telemetry-observed effective model identity. Delivery-gating
requested-versus-effective telemetry is out of scope.

Exact lines to emit:

```text
Reviewer: github-copilot (runner-reviewer-role)
Reviewer: claude (runner-reviewer-role; effort xhigh→high)
```

Sites:

- `src/output/console.ts` — `ConsoleReporter.printSummary` prints `Status: <overall>` then a bold
  separator. Print the identity line after the status line. Called from `src/core/runner.ts:168`
  and `:183`.
- `src/output/report.ts` — `generateReport(status, gateResults, logDir)` starts its line array with
  `statusLineText(status)` and returns early when there are no gate results. Print the identity line
  after the status line, and make sure it survives that early return, so a passing run with an
  override still names the identity.
- `src/core/reconciliation.ts:70` calls `generateReport('trusted', undefined, args.logDir)` on the
  trusted short-circuit. That path must also name the identity. Do not add a RESULTS SUMMARY to the
  trusted path if it does not already print one. Trust matching itself must not change: a valid
  overlay on a trusted HEAD still short-circuits exactly as it does today.

When no override is active, output must be byte-for-byte what it is today. Specifically, do not add
a `source=project-config` line, and do not add any reviewer line at all.

`generateReport` is reached from `src/core/run-executor.ts:182`, `src/core/run-executor-helpers.ts:400`,
and the reconciliation path above; the report text is also written to a file as a stdout fallback,
which is existing behaviour to preserve.

### Capabilities

`agent-validator metrics capabilities` is already the probe Agent Runner runs before launch. Current
Runner requires `capabilities_version == 1` and ignores unknown JSON keys. Reuse that document for
bootstrap feature detection by adding, to the object written in `src/commands/metrics.ts` (the
`capabilities` action around line 46):

```json
"reviewer_override": { "supported": true }
```

Keep `CAPABILITIES_VERSION` at `1` (`src/metrics/types.ts:5`). Bumping it would break today's Runner
on the Validator-first ship order. Adding the field while holding the version is a deliberate,
bounded exception to the published closed v1 capabilities schema: that envelope may grow additive
bootstrap feature flags. It is not a measurement, protocol, or artifact schema change, and it must
not touch export, acknowledgment, discard, pending inventory, or delivery.

Schema and fixture updates required, because both declare the shape strictly:

- `contracts/validator-metrics/v1/capabilities.schema.json` sets `"additionalProperties": false`, so
  `reviewer_override` must be declared, and it is required.
- `src/metrics/validation.ts:398` — `capabilitiesSchema` is a `.strict()` Zod object with a
  `superRefine` over `limits`. It must accept a document carrying `reviewer_override`.
- `contracts/validator-metrics/v1/README.md` describes capabilities negotiation; document the new
  flag there.
- `test/metrics/contracts.test.ts` builds capabilities fixtures inline around lines 241 and 245;
  update them.

The capabilities response must not depend on project configuration, must not create storage, and
must not read, validate, or apply the reviewer environment variables. Advertisement is unconditional
whenever this change is present.

One known limitation is accepted by decision and is not yours to fix. The emitted capabilities
document already carries seven keys the shipped strict schema does not declare: `ok`, `operation`,
`protocol_version`, `producer`, `artifact_schema_versions`, `operations`, and `diagnostics`. Nothing
validates emitted output against that schema today. Assert that the schema file and the Zod
validator accept a document containing `reviewer_override`. Do not assert emitted output against the
schema, and do not reconcile the existing drift.

### Documentation

Update `docs/metrics-contract.md` and `docs/metrics-retrieval.md` for the advertised flag and the
documented closed-schema exception. Note in the reviews or running-validation documentation that a
run under an active override names the configured review identity in both the summary and the
report.

## Spec

### Requirement: Overlay-command configured identity
When an overlay command runs with override mode active, its stderr RESULTS SUMMARY SHALL name the configured review identity: source `runner-reviewer-role`, the mapped adapter, and the `xhigh` → `high` collapse when that mapping occurred. That identity is the configured overlay, not telemetry-observed effective model identity. When override mode is not active, Validator SHALL NOT add a `project-config` identity line.

#### Scenario: Override run names configured identity
- **WHEN** `run` completes with override mode active mapped to `github-copilot`
- **THEN** stderr RESULTS SUMMARY SHALL name source `runner-reviewer-role` and adapter `github-copilot`

#### Scenario: No override leaves summary unchanged
- **WHEN** `run` completes with no reviewer override environment
- **THEN** stderr RESULTS SUMMARY SHALL NOT add a reviewer identity source line

### Requirement: Report flag writes self-contained failure report to stdout
When `agent-validate run` is invoked with `--report`, the command SHALL write a structured, agent-actionable failure report to stdout. Stderr output SHALL remain unchanged. When no failures exist and no reviewer override is active, stdout SHALL contain only the status line. When a reviewer override is active, stdout SHALL also include the configured review identity named by the reviewer-override capability (source `runner-reviewer-role`, mapped adapter, and `xhigh` collapse when it occurred). The report MUST be self-contained — an agent reading only the report MUST have enough information to understand what failed and begin fixing it. The report MUST also be written to a file as a fallback for environments where stdout may be lost.

#### Scenario: All gates pass
- **WHEN** `agent-validate run --report` completes and all gates pass
- **AND** no reviewer override is active
- **THEN** stdout SHALL contain a single line: `Status: Passed`

#### Scenario: All gates pass with skipped violations
- **WHEN** `agent-validate run --report` completes and all gates pass but some violations were skipped
- **AND** no reviewer override is active
- **THEN** stdout SHALL contain `Status: Passed with warnings`

#### Scenario: All gates pass with reviewer override
- **WHEN** `agent-validate run --report` completes and all gates pass
- **AND** reviewer override mode is active
- **THEN** stdout SHALL contain the status line
- **AND** stdout SHALL name the configured review identity (`runner-reviewer-role` and the mapped adapter)

#### Scenario: Trusted short-circuit with reviewer override
- **WHEN** `agent-validate run --report` returns trusted without dispatching gates
- **AND** reviewer override mode is active
- **THEN** stdout SHALL still name the configured review identity
- **AND** trust matching SHALL be unchanged from today

#### Scenario: Check gate fails
- **WHEN** a check gate fails during a `--report` run
- **THEN** stdout SHALL include a CHECK FAILURES section containing:
  - The gate label (e.g., `check:src:lint`)
  - The command that was executed
  - The working directory the command ran in
  - Fix instructions if configured for the gate
  - Fix skill name if configured for the gate
  - The path to the full log file
- **AND** the report SHALL NOT include parsed error output from the check log — the agent reads the log file directly when it needs error details

#### Scenario: Review gate has new violations
- **WHEN** a review gate fails with violations whose status is `"new"`
- **THEN** stdout SHALL include a REVIEW VIOLATIONS section containing each violation with:
  - A stable numeric ID (e.g., `#1`, `#2`)
  - Priority level in brackets (e.g., `[high]`)
  - The gate label and adapter suffix (e.g., `review:src:code-quality (claude@1)`)
  - `file:line - issue description`
  - Fix suggestion
  - Path to the JSON file containing the violation

#### Scenario: Review violations with non-new status are excluded
- **WHEN** a review gate has violations with status `"fixed"` or `"skipped"`
- **THEN** those violations SHALL NOT appear in the report and SHALL NOT be assigned numeric IDs

#### Scenario: Report flag absent
- **WHEN** `agent-validate run` is invoked without `--report`
- **THEN** stdout behavior SHALL be unchanged from current behavior
- **AND** stderr RESULTS SUMMARY SHALL still name the configured review identity when reviewer override is active, per reviewer-override

### Requirement: Capabilities advertise reviewer-override support
`metrics capabilities` SHALL advertise reviewer-override support on the existing capabilities document with `capabilities_version` remaining `1` and `reviewer_override: { "supported": true }`. This advertisement is bootstrap feature detection for callers such as Runner. It SHALL NOT require project configuration, create storage, inspect reviewer environment variables, or change export, acknowledgment, discard, pending inventory, measurement schemas, protocol version, or artifact version.

Adding `reviewer_override` while keeping `capabilities_version` `1` is an explicit exception to the published closed v1 capabilities schema: this envelope MAY grow additive bootstrap feature flags. It is not a measurement, protocol, or artifact schema change. The published v1 capabilities schema and fixtures SHALL include the flag. Current Agent Runner ignores unknown JSON keys and requires `capabilities_version == 1`; it SHALL continue to accept the document. A Validator that omits `reviewer_override.supported` SHALL be treated by new Runner as lacking the override (Runner behavior). Validator itself SHALL emit the flag whenever this change is present.

#### Scenario: Capabilities includes reviewer_override without a project
- **WHEN** `metrics capabilities` is invoked with no project configuration
- **THEN** the JSON response SHALL include `capabilities_version` `1` and `reviewer_override.supported` true
- **AND** the command SHALL create no storage

#### Scenario: Capabilities does not depend on reviewer env
- **WHEN** `metrics capabilities` is invoked with or without reviewer override environment variables
- **THEN** the response SHALL still advertise `reviewer_override.supported` true
- **AND** it SHALL NOT enable, apply, or validate the override

#### Scenario: Metrics data operations are unchanged
- **WHEN** a caller invokes `metrics export`, `acknowledge`, `discard`, or `pending`
- **THEN** those operations SHALL behave as specified by the existing nested-metrics-handoff retrieval contract
- **AND** they SHALL NOT interpret `reviewer_override` as a measurement or delivery field

## Test Plan

### INT-004: Capabilities document advertises support
- Covers: Capabilities advertise reviewer-override support
- Boundary: the `metrics capabilities` emitter, the shipped `contracts/validator-metrics/v1`
  capabilities schema file, and the Zod capabilities validator
- Setup: a directory with no project configuration, exercised both with and without reviewer
  environment variables set
- Action: invoke `metrics capabilities`
- Assertions: the response carries `capabilities_version` `1` and `reviewer_override.supported`
  true; the environment does not change the response and is neither validated nor applied; no
  storage is created; the shipped schema file and the Zod validator both accept a document
  containing `reviewer_override`
- Execution: `test/metrics/`, run by `bun test`

### E2E-001: Override reaches the reviewer subprocess
- Covers: Environment-inherited reviewer override; Reviewer triple translation; Preference
  replacement and adapter policy; Overlay-command configured identity; Report flag
- Surface: the built `dist` binary, spawned as a child process
- Setup: temp git repository with a real diff. The tracked configuration pins one adapter as
  `default_preference` and pins a review to that same adapter, and defines no block for the adapter
  the override will select. A recording stub for the target adapter is placed on `PATH` and captures
  its own invocation. The reviewer environment supplies that adapter, a model, and effort `xhigh`
- Journey: run the validator with `--report`
- Assertions: the target adapter's stub is invoked and the originally configured adapter is never
  invoked; the captured invocation carries the role's model and a `high` thinking budget; tool use
  is not enabled; the stderr summary names source `runner-reviewer-role`, the mapped adapter, and
  the `xhigh` to `high` collapse; `--report` stdout names the same identity; the tracked
  `.validator/config.yml` is byte-identical before and after the run
- Execution: `test/integration/`, run by `bun run test:e2e`

### E2E-003: Trusted short-circuit still names the identity
- Covers: Overlay-command configured identity; Report flag
- Surface: the built `dist` binary, spawned as a child process
- Setup: a temp git repository validated once so its head is trusted, then invoked again with a
  valid reviewer override
- Journey: run the validator with `--report` against the trusted head
- Assertions: the run short-circuits as trusted and dispatches no reviewer; `--report` stdout still
  names the configured review identity; trust matching is identical to the same short-circuit
  without any override environment
- Execution: `test/integration/`, run by `bun run test:e2e`

## Done When

- `ConsoleReporter.printSummary` and `generateReport` name the configured review identity, including
  the `xhigh` to `high` collapse, only when an override was applied, reading the identity attached to
  the loaded configuration rather than re-reading the environment.
- The trusted short-circuit report names the identity, and trust matching is unchanged.
- With no override environment, summary and report output are unchanged from today, with no
  `project-config` line added.
- `metrics capabilities` emits `reviewer_override: { "supported": true }` with `capabilities_version`
  still `1`, with no project configuration required, no storage created, and no reading of reviewer
  environment variables.
- `contracts/validator-metrics/v1/capabilities.schema.json`, its README, the Zod `capabilitiesSchema`
  in `src/metrics/validation.ts`, and the capabilities fixtures in `test/metrics/contracts.test.ts`
  all declare and accept the new field. Measurement, protocol, and artifact versions are untouched,
  and export, acknowledge, discard, and pending behaviour is unchanged.
- Every scenario in the three requirements above is demonstrated by an automated test.
- `INT-004`, `E2E-001`, and `E2E-003` are implemented at the stated boundaries and pass.
- `docs/metrics-contract.md` and `docs/metrics-retrieval.md` document the advertised flag and the
  closed-schema exception, and the reviews or running-validation documentation notes the
  configured-identity line.
- `bun run test` and `bun run test:e2e` pass. Validate this change by building the current checkout
  and invoking it directly with `bun run build:npm && node dist/index.js run`; do not use an
  `agent-validator` command resolved from `PATH`.
