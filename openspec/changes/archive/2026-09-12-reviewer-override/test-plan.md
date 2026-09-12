# Test Plan: reviewer-override

## Coverage Strategy

Specifications remain the source of unit-test requirements. This plan records only additional
integration, end-to-end, agent-acceptance, and exceptional human-only obligations.

Pure translation logic belongs in unit tests and is not inventoried here: trimming, any-variable
activation, exact-case comparison, the `copilot` and `xhigh` mappings, and rejection of unknown
values. The obligations below exist because the override's real risk is wiring, not arithmetic.
Three failure modes drive the selection.

- **Ordering.** Preference replacement must happen before the check that a review CLI appears in
  `default_preference`. Only a real config load through the merge step proves that.
- **Command selection.** `check` and `review` share one gate entry point. A missed call site makes
  `check` fail on reviewer environment it must ignore, or lets `run` overlay nothing.
- **Silent tool enablement.** Overlaying an adapter the project never configured must take
  `allow_tool_use` from init defaults, not the schema default of `true` and not the displaced
  adapter. This fails open and produces no error, so it needs assertions at both the config layer
  and the dispatched subprocess.

One adapter deserves explicit mention. `gemini` is a valid Validator adapter but is not a mapped
Runner CLI value, so it must be rejected. Implementing the mapping check against the adapter
registry instead of the Runner value set passes every happy-path test and fails only here.

### Known limitation

The emitted `metrics capabilities` document already carries seven keys the shipped strict schema
does not declare: `ok`, `operation`, `protocol_version`, `producer`, `artifact_schema_versions`,
`operations`, and `diagnostics`. Nothing validates emitted output against that schema today. This
plan therefore asserts that the schema and the Zod validator accept a document containing
`reviewer_override`, and does not assert emitted output against the schema. Reconciling that drift
is deferred by decision and is not an obligation of this change.

## Integration Tests

### INT-001: Preference replacement survives the merge step
- Covers: Preference replacement and adapter policy; Reviewer triple translation
- Boundary: `loadConfig` with `applyReviewerOverride`, a real YAML file on disk, inline-gate
  extraction, and `mergeCliPreferences`
- Setup: temp project whose `.validator/config.yml` sets `cli.default_preference: [codex]`, one
  review pinned to `cli_preference: [codex]`, one review with `num_reviews: 2`, and one review with
  `enabled: false`; reviewer environment mapping to `claude`
- Action: load the configuration for an overlay command
- Assertions: loading does not fail on the displaced `codex` preference; `default_preference` and
  every review `cli_preference` hold the single mapped adapter; `num_reviews: 2` yields two slots of
  that one adapter rather than a restored multi-CLI panel; the disabled review still generates no
  jobs; the loaded configuration carries the override identity
- Execution: `test/config/`, run by `bun test`

### INT-002: Adapter policy never inherits tool permission
- Covers: Preference replacement and adapter policy
- Boundary: `loadConfig` overlay, exported init `ADAPTER_CONFIG` defaults, and the configuration
  schema's own defaults
- Setup: two temp projects. The first configures the mapped adapter with `allow_tool_use: false` and
  a per-review `model`. The second configures only a different adapter, with `allow_tool_use: true`,
  and has no block for the mapped adapter. Both receive a reviewer environment supplying CLI, model,
  and effort
- Action: load the configuration for an overlay command
- Assertions: the existing block keeps `allow_tool_use: false` while the role's model and mapped
  thinking budget are applied on top; the missing block is created with `allow_tool_use: false` from
  init defaults, which is neither the schema default of `true` nor the displaced adapter's `true`;
  the role's model takes precedence over the per-review YAML model
- Execution: `test/config/`, run by `bun test`

### INT-003: Overlay command selection and fail-closed wiring
- Covers: Environment-inherited reviewer override; Reviewer triple translation
- Boundary: command entry points against a real project on disk, including the gate entry point
  shared by `check` and `review`, and the ordering of configuration load against lock acquisition
  and reconciliation
- Setup: temp git project with a valid configuration defining both checks and reviews. Malformed
  environments exercised: model only with no CLI; effort only with no CLI; `gemini` as the CLI; an
  unknown effort value; `Copilot` with the wrong case
- Action: invoke each command under each environment
- Assertions: `run`, `review`, `health`, `list`, and `detect` exit nonzero for every malformed
  environment, fail before any gate dispatches, and produce a message naming the offending variable;
  `check`, `validate`, `clean`, `skip`, `update-review`, metrics operations, and CI job listing
  ignore the environment entirely and behave on their own merits
- Execution: `test/commands/`, run by `bun test`

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

## End-to-End Tests

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

### E2E-002: Fail-closed leaves no trace and does not touch check
- Covers: Environment-inherited reviewer override
- Surface: the built `dist` binary, spawned as a child process
- Setup: the same temp git repository, with only `AGENT_VALIDATOR_REVIEWER_MODEL` set
- Journey: invoke `run`, then invoke `check` in the same repository under the same environment
- Assertions: `run` exits nonzero with a message naming the required CLI variable; no log directory,
  lock, or session artifact is created by the failed run; `check` executes the configured checks and
  exits on their result; the tracked configuration is unchanged
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

## Agent Acceptance Tests

Acceptance uses a genuinely installed and authorized reviewer CLI. Stub adapters satisfy the
automated obligations above and do not satisfy these flows. Per repository instructions, the binary
under test is built from the current checkout with `bun run build:npm` and invoked as
`node dist/index.js`, never an `agent-validator` resolved from `PATH`.

### AT-001: Orchestrator handshake and override run
- Classification: Required
- Covers: Capabilities advertise reviewer-override support; Environment-inherited reviewer override;
  Overlay-command configured identity; Report flag
- Actor and surface: an orchestrating caller driving the Validator CLI the way Agent Runner will
- Setup: a scratch git repository containing a small real code change; a tracked
  `.validator/config.yml` defining one review pinned to an adapter that the override will displace;
  the mapped adapter's real CLI installed and authorized
- Steps: probe `metrics capabilities` and read `reviewer_override.supported`; export the three
  reviewer variables naming the mapped adapter, a model, and an effort; run the validator with
  `--report`; read the stderr summary and the stdout report; check the tracked configuration for
  modification
- Expected: the real reviewer CLI runs and returns a verdict; the summary and report name source
  `runner-reviewer-role` and the mapped adapter; the displaced adapter is absent from the run; the
  tracked configuration is unmodified
- Evidence: the capabilities JSON, the full stderr summary, the `--report` stdout, a git status and
  diff showing the tracked configuration untouched, and the review log showing the real CLI's output
- Effects and cleanup: consumes real reviewer tokens against the user's authorized account; the
  scratch repository is removed afterward; no network effect outside the reviewer CLI
- Permitted substitutes: None

### AT-002: Override to an adapter the project never configured
- Classification: Required
- Covers: Preference replacement and adapter policy; Reviewer triple translation
- Actor and surface: the same orchestrating caller driving the Validator CLI
- Setup: a scratch git repository whose tracked configuration defines exactly one adapter block,
  with `allow_tool_use` enabled, and no block for the adapter the override will select; that second
  adapter's real CLI installed and authorized; an effort of `xhigh` so the collapse is exercised
- Steps: export the reviewer variables naming the unconfigured adapter; run the validator with
  `--report`; read the summary and report; inspect the review log and any recorded reviewer
  invocation for tool permission and thinking budget
- Expected: the unconfigured adapter runs and returns a verdict; tool use is not enabled, so the
  displaced adapter's permission was not inherited; the effort collapse from `xhigh` to `high` is
  named in the output; the tracked configuration is unmodified
- Evidence: the stderr summary naming the collapse, the `--report` stdout, the review log, and
  evidence of the reviewer invocation's tool permission and thinking budget
- Effects and cleanup: consumes real reviewer tokens against the user's authorized account; the
  scratch repository is removed afterward
- Permitted substitutes: None

### AT-003: Misconfiguration is diagnosable
- Classification: Required
- Covers: Environment-inherited reviewer override
- Actor and surface: the same orchestrating caller driving the Validator CLI
- Setup: a scratch git repository with a valid configuration defining both a check and a review; a
  reviewer environment that activates override mode with a CLI value that is not mapped, using both
  `gemini` and a wrong-case `Copilot`
- Steps: run the validator and read the failure; run `check` in the same repository under the same
  environment
- Expected: the run fails before any gate with a message that names the offending variable and is
  actionable enough to correct the environment without reading source; `check` ignores the
  environment and runs the configured check normally
- Evidence: the failure output and exit code for each bad value, and the `check` output under the
  same environment
- Effects and cleanup: no reviewer CLI is invoked, because the command fails before dispatch; this
  is a property of the flow, not a substitute; the scratch repository is removed afterward
- Permitted substitutes: None

## Human-Only Testing

None. Every obligation is observable through the CLI, and the reviewer CLIs this change targets are
installed and authorized in the working environment, so an agent can drive the real-adapter
acceptance flows directly.

## Coverage Map

| Requirement or journey | INT | E2E | AT | HT |
| --- | --- | --- | --- | --- |
| Environment-inherited reviewer override | INT-003 | E2E-001, E2E-002 | AT-001, AT-003 | — |
| Reviewer triple translation | INT-001, INT-003 | E2E-001 | AT-002 | — |
| Preference replacement and adapter policy | INT-001, INT-002 | E2E-001 | AT-002 | — |
| Overlay-command configured identity | — | E2E-001, E2E-003 | AT-001 | — |
| Capabilities advertise reviewer-override support | INT-004 | — | AT-001 | — |
| Report flag names override identity | — | E2E-001, E2E-003 | AT-001 | — |
