# Task: Reviewer override env contract, translation, and in-memory config overlay

## Goal

Agent Runner will export a `{cli, model, effort}` reviewer triple through inherited environment.
Make Agent Validator read that triple, translate it into Validator adapter vocabulary, and apply it
as an in-memory overlay on the commands that choose a reviewer, without ever writing the project's
tracked `.validator/config.yml`. A malformed override must fail the command closed, before any gate
runs, rather than silently falling back to the project's configured reviewers.

This is the behavioural core of the change. When it is done, `run`, `review`, `health`, `list`, and
`detect` dispatch against the overridden reviewer identity, and `check`, `validate`, `clean`, `skip`,
`update-review`, metrics operations, and CI job listing ignore the reviewer environment entirely.

## Background

### Why this shape

Reviewer identity for `run` / `review` is owned today by the tracked project file:
`cli.default_preference`, per-review `cli_preference`, and `cli.adapters`. Changing who reviews means
editing a repo file by hand. Runner owns the other agent identities, so verification sits on a second
control plane. An environment-inherited override closes that split without a user-level `cli:` block
and without rewriting tracked YAML.

The override is a command-selected overlay, not an unconditional `loadConfig()` side effect. A bad
reviewer environment must not be able to break commands that never choose a reviewer.

### Repository facts you need

- `src/config/loader.ts` — `loadConfig(rootDir = process.cwd())` today takes only a root directory.
  It parses YAML through `validatorConfigSchema`, infers `default_preference` from adapter keys when
  unset, extracts inline gates, loads checks and reviews, then calls `mergeCliPreferences`.
- `mergeCliPreferences` in the same file throws when a review's `cli_preference` names a tool outside
  `cli.default_preference`: `Review "<name>" uses CLI tool "<tool>" which is not in the project-level
  allowed list (cli.default_preference).` Preference replacement MUST happen before this call, or a
  review pinned to the displaced CLI will fail the load.
- `src/config/types.ts` — `LoadedConfig` is `{ project, checks, reviews }`. Add the override identity
  here.
- `src/commands/init-config-helpers.ts:14` — `ADAPTER_CONFIG` is currently a module-private
  `Record<string, AdapterCfg>` holding Validator's init defaults:

  ```ts
  claude: { allow_tool_use: false, thinking_budget: 'high' },
  codex: { allow_tool_use: false, thinking_budget: 'medium' },
  gemini: { allow_tool_use: false, thinking_budget: 'low' },
  cursor: { allow_tool_use: false, thinking_budget: 'low', model: 'codex' },
  'github-copilot': { allow_tool_use: false, thinking_budget: 'low', model: 'codex' },
  opencode: { allow_tool_use: false, thinking_budget: 'low' },
  ```

  Export it (or lift it into a shared module both files import) rather than duplicating the values.
  Init defaults are the policy source, not schema defaults: the schema default for an unspecified
  `allow_tool_use` is `true`, so switching to an adapter the project never configured must not enable
  tools by accident.
- `src/gates/review-runtime-helpers.ts:26` — dispatch resolves `model: adapterCfg?.model ?? config.model`
  and reads `allowToolUse` / `thinkingBudget` from the adapter block. That is why an overlay adapter
  model takes precedence over a per-review YAML `model`.
- `loadConfig` call sites: `src/core/run-executor.ts:249`, `src/commands/gate-command.ts:66`,
  `src/commands/health.ts:103`, `src/commands/list.ts:11`, `src/commands/detect.ts:118`,
  `src/commands/validate.ts:11`, `src/commands/clean.ts:24`, `src/commands/skip.ts:29`,
  `src/commands/update-review.ts:47` and `:105`, `src/commands/ci/list-jobs.ts:82`.
- `src/commands/gate-command.ts` is shared by `check` and `review` through `initializeDebugLogger`.
  This is the easy-to-miss call site: the overlay applies only when the command name is `review`.
- In `src/core/run-executor.ts`, `loadConfig` runs before `tryAcquireLock` and before
  `reconcileStartup`. Keep that order so an invalid override fails before the lock, before
  reconciliation, and before any gate dispatch, including on a trusted HEAD.

### Implementation approach

Add `src/config/reviewer-override.ts` holding pure environment parsing and mapping:

- Read `AGENT_VALIDATOR_REVIEWER_CLI`, `AGENT_VALIDATOR_REVIEWER_MODEL`,
  `AGENT_VALIDATOR_REVIEWER_EFFORT`. Trim each value; empty after trim is absent.
- Activation is the presence of any one of the three.
- Once active, CLI must be present, non-empty after trim, and one of
  `claude`, `codex`, `cursor`, `opencode`, `copilot`. Comparison is exact after trim, so `Copilot`
  is not `copilot`. Implement the check against this Runner value set, not against the Validator
  adapter registry: `gemini` is a valid Validator adapter but is not a mapped Runner CLI value and
  must be rejected.
- Effort, when present, must be `low`, `medium`, `high`, or `xhigh`. `xhigh` maps to `high` and the
  collapse is recorded on the parse result. Effort cannot express `thinking_budget: off`.
- `copilot` maps to adapter key `github-copilot`; the other four map to the same string.
- Throw a small dedicated error type whose message names the offending variable and the problem, so
  the CLI wrappers keep today's nonzero config-error exit code. Do not read the environment again
  later; the parse result is the single source.

Extend `loadConfig` with an options argument carrying `applyReviewerOverride`, defaulting to `false`.
When `true`, after schema parse and inline-gate extraction and before `mergeCliPreferences`:

1. Inactive parse result: load exactly as today.
2. Throwing parse: propagate. Do not merge, do not return a config, do not acquire the run lock.
3. Replace `project.cli.default_preference` and every `reviews[name].cli_preference` with the single
   mapped adapter. These lists are replaced, not validated against the old project list.
4. Overlay the adapter block. If `project.cli.adapters[mapped]` exists, keep its `allow_tool_use`
   and apply the role's model (when supplied) and the mapped thinking budget (when effort was
   supplied). If it does not exist, create it from the init defaults for that adapter, then apply
   the role's model and mapped thinking budget.
5. Set the override identity on `LoadedConfig` (source `runner-reviewer-role`, the mapped adapter,
   and an `xhigh` collapse marker only when that mapping actually happened) so later consumers do
   not re-parse the environment. Consumers of that field ship separately; setting it correctly here
   is part of this task.

Wire `applyReviewerOverride: true` at `executeRun`, `health`, `list`, and `detect`, and at
`gate-command` only when the command name is `review`. Leave every other call site on the tracked
project file. Metrics commands do not call `loadConfig` for capabilities; do not parse reviewer
environment there.

Gates, checks, review enablement, and `num_reviews` stay exactly as configured. A `num_reviews` of 2
becomes two slots of the one mapped adapter; do not restore a multi-CLI panel. Existing adapter
availability and health-skip rules continue to apply unchanged; do not add a fail-if-uninstalled rule.

Trusted-snapshot lookup, reconciliation, and `config_hash` gating are out of scope and must not
change. A valid overlay on a trusted HEAD still short-circuits exactly as it does today.

### Documentation

Update `docs/reviews-and-adapters.md` and `docs/config-reference.md` with the environment variable
names, the activation rule, the CLI and effort mapping table including `copilot` → `github-copilot`
and the lossy `xhigh` → `high` collapse, the adapter-policy rule that `allow_tool_use` is never
copied from the displaced adapter, the exact set of overlay commands, and the fact that a Runner
profile can disagree with the tracked file while that file is never rewritten.

## Spec

### Requirement: Environment-inherited reviewer override
Validator SHALL read inherited environment variables `AGENT_VALIDATOR_REVIEWER_CLI`, `AGENT_VALIDATOR_REVIEWER_MODEL`, and `AGENT_VALIDATOR_REVIEWER_EFFORT`. Values SHALL be trimmed of surrounding whitespace; a value that is empty after trimming SHALL be treated as absent.

Presence of any of the three variables SHALL activate override mode. Once override mode is active, `AGENT_VALIDATOR_REVIEWER_CLI` MUST be present, non-empty after trim, and a mapped adapter; otherwise the overlay command SHALL fail before any gates run and SHALL NOT fall back to the project's configured reviewers. Absent model or effort SHALL NOT overlay those fields. Unknown CLI or effort SHALL fail the same way as a missing CLI.

Override mode SHALL apply only to overlay commands: `run`, `review`, `health`, `list`, and `detect`. `check`, `validate`, `clean`, `skip`, `update-review`, metrics operations, and CI job listing SHALL ignore these variables and use the tracked project configuration. Validator SHALL NOT write `.validator/config.yml` because of the override.

#### Scenario: No override environment
- **WHEN** none of the three reviewer environment variables is set
- **THEN** overlay commands SHALL use the project's loaded review configuration
- **AND** report output SHALL NOT add a reviewer-override identity line

#### Scenario: CLI-only override
- **WHEN** `run` is invoked with `AGENT_VALIDATOR_REVIEWER_CLI` set to a mapped adapter and model and effort absent
- **THEN** the command SHALL activate override mode and overlay that adapter
- **AND** it SHALL NOT overlay model or thinking budget from the role

#### Scenario: Partial environment without CLI
- **WHEN** an overlay command is invoked with `AGENT_VALIDATOR_REVIEWER_MODEL` or `AGENT_VALIDATOR_REVIEWER_EFFORT` set and CLI absent
- **THEN** the command SHALL fail before any gates
- **AND** it SHALL NOT dispatch checks or reviews using the project reviewers

#### Scenario: Unknown CLI
- **WHEN** an overlay command is invoked with `AGENT_VALIDATOR_REVIEWER_CLI` set to a value that is not a mapped adapter
- **THEN** the command SHALL fail before any gates

#### Scenario: Unknown effort
- **WHEN** an overlay command is invoked with a valid mapped CLI and `AGENT_VALIDATOR_REVIEWER_EFFORT` set to a value other than `low`, `medium`, `high`, or `xhigh`
- **THEN** the command SHALL fail before any gates

#### Scenario: Check ignores override environment
- **WHEN** `check` is invoked with reviewer environment variables set, including a malformed override
- **THEN** the command SHALL ignore those variables
- **AND** it SHALL run checks from the tracked project configuration

#### Scenario: Validate ignores override environment
- **WHEN** `validate` is invoked with a malformed reviewer override environment
- **THEN** the command SHALL ignore those variables
- **AND** it SHALL validate the tracked configuration file rather than fail because of the environment

#### Scenario: Overlay commands fail closed on malformed env
- **WHEN** `health`, `list`, or `detect` is invoked with override mode activated and CLI missing or unmapped
- **THEN** the command SHALL fail immediately
- **AND** it SHALL NOT report project reviewers as the effective overlay

#### Scenario: Tracked config is not rewritten
- **WHEN** `run` completes successfully under an active reviewer override
- **THEN** the project's tracked `.validator/config.yml` SHALL be unchanged

### Requirement: Reviewer triple translation
When override mode is active, Validator SHALL translate the Runner triple into Validator adapter vocabulary. Mapped CLI values SHALL be `claude`, `codex`, `cursor`, and `opencode` (same adapter key) and `copilot` (adapter key `github-copilot`). Any other CLI SHALL be unmapped. Model SHALL be applied unchanged when present. Effort `low`, `medium`, and `high` SHALL map to the same `thinking_budget` string. Effort `xhigh` SHALL map to `thinking_budget` `high` and the collapse SHALL be reported on overlay-command output. Effort SHALL NOT express `thinking_budget: off`. CLI comparison SHALL be exact after trim; `Copilot` is not `copilot`.

#### Scenario: Copilot maps to github-copilot
- **WHEN** override mode is active with `AGENT_VALIDATOR_REVIEWER_CLI=copilot`
- **THEN** the mapped adapter SHALL be `github-copilot`

#### Scenario: xhigh collapses to high
- **WHEN** override mode is active with `AGENT_VALIDATOR_REVIEWER_EFFORT=xhigh`
- **THEN** the overlaid thinking budget SHALL be `high`
- **AND** overlay-command output SHALL name that collapse

#### Scenario: Medium effort passes through
- **WHEN** override mode is active with `AGENT_VALIDATOR_REVIEWER_EFFORT=medium`
- **THEN** the overlaid thinking budget SHALL be `medium`

### Requirement: Preference replacement and adapter policy
When overlaying for an overlay command, Validator SHALL replace `cli.default_preference` and every review `cli_preference` with the single mapped adapter before the check that a review CLI must appear in `default_preference`. Gates, checks, review enablement, and `num_reviews` SHALL remain as configured. A list-valued reviewer role is out of scope; `num_reviews` greater than one SHALL produce that many slots of the one mapped adapter.

Per-adapter `allow_tool_use` SHALL NOT be copied from the adapter being replaced. If `cli.adapters.<mapped>` already exists, Validator SHALL keep that block's `allow_tool_use` and apply the role's model and mapped thinking budget on top. If that block does not exist, Validator SHALL create it from Validator init defaults for that adapter (`allow_tool_use: false` plus the adapter's documented init `thinking_budget` and `model` where present), then apply the role's model and mapped thinking budget. When the role supplies a model, that overlay adapter model SHALL take precedence over a per-review YAML `model`. After overlay, existing adapter availability and health skipping SHALL apply; the overlay SHALL NOT add a separate fail-if-uninstalled rule.

#### Scenario: Review pinned to another CLI is replaced
- **WHEN** a review is configured with `cli_preference: [codex]` and override mode maps to `claude`
- **THEN** that review SHALL run with `claude`
- **AND** configuration loading SHALL NOT fail because `codex` is outside the replaced default preference list

#### Scenario: num_reviews remains a count of the one agent
- **WHEN** a review is configured with `num_reviews: 2` and override mode maps to a single adapter
- **THEN** Validator SHALL generate two review slots of that mapped adapter
- **AND** it SHALL NOT restore a multi-CLI panel

#### Scenario: Enablement is unchanged
- **WHEN** a review is configured with `enabled: false` and override mode is active
- **AND** the review is not named by `--enable-review`
- **THEN** that review SHALL NOT generate jobs

#### Scenario: Existing mapped adapter keeps allow_tool_use
- **WHEN** `cli.adapters.claude.allow_tool_use` is `false` and override mode maps to `claude`
- **THEN** Claude reviews SHALL keep `allow_tool_use` false
- **AND** they SHALL NOT inherit tool policy from a displaced adapter

#### Scenario: Missing mapped adapter uses init defaults
- **WHEN** override mode maps to `claude` and `cli.adapters.claude` does not exist
- **AND** the project had configured a different adapter with its own `allow_tool_use`
- **THEN** Validator SHALL create the Claude adapter block from init defaults
- **AND** Claude SHALL NOT copy `allow_tool_use` from the displaced adapter

## Test Plan

Pure translation logic belongs in implementation-time unit tests and is not inventoried below:
trimming, any-variable activation, exact-case comparison, the `copilot` and `xhigh` mappings, and
rejection of unknown values. Write those as TDD unit coverage alongside the parser. The obligations
below exist because the real risk in this work is wiring, not arithmetic.

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

### E2E-002: Fail-closed leaves no trace and does not touch check
- Covers: Environment-inherited reviewer override
- Surface: the built `dist` binary, spawned as a child process
- Setup: a temp git repository with a valid configuration, with only
  `AGENT_VALIDATOR_REVIEWER_MODEL` set
- Journey: invoke `run`, then invoke `check` in the same repository under the same environment
- Assertions: `run` exits nonzero with a message naming the required CLI variable; no log directory,
  lock, or session artifact is created by the failed run; `check` executes the configured checks and
  exits on their result; the tracked configuration is unchanged
- Execution: `test/integration/`, run by `bun run test:e2e`

## Done When

- `src/config/reviewer-override.ts` exists with pure environment parsing, validation, and mapping,
  and throws a dedicated error naming the offending variable.
- `loadConfig` accepts an `applyReviewerOverride` option defaulting to `false`, applies the overlay
  before `mergeCliPreferences`, and attaches the override identity to `LoadedConfig` including the
  `xhigh` collapse marker when that mapping occurred.
- Init adapter defaults are exported and reused rather than duplicated; no overlay path copies
  `allow_tool_use` from a displaced adapter.
- `executeRun`, `health`, `list`, `detect`, and `gate-command` for `review` pass the option; `check`,
  `validate`, `clean`, `skip`, `update-review`, metrics operations, and CI job listing do not.
- Every scenario in the three requirements above is demonstrated by an automated test.
- `INT-001`, `INT-002`, `INT-003`, and `E2E-002` are implemented at the stated boundaries and pass.
- `docs/reviews-and-adapters.md` and `docs/config-reference.md` document the environment contract,
  the mapping table, the adapter policy, and the overlay command set.
- `bun run test` and `bun run test:e2e` pass. Validate this change by building the current checkout
  and invoking it directly with `bun run build:npm && node dist/index.js run`; do not use an
  `agent-validator` command resolved from `PATH`.
