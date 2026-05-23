## ADDED Requirements

### Requirement: Init accepts --enable-builtin to scaffold opt-in built-in reviews

The `init` command SHALL accept a repeatable `--enable-builtin <name>` option. Each `<name>` SHALL be the name of an opt-in built-in review (currently `task-compliance` and `test-integrity`; the set is defined by `optInBuiltIns` in `src/built-in-reviews/index.ts`).

For each requested name, fresh init SHALL write an inline review entry under the root entry point's `reviews:` list in `config.yml` with:

- the review name equal to `<name>`,
- `builtin: <name>`,
- `enabled: false`,
- a YAML comment on the `enabled: false` line reading: `Opt-in: activate with` followed by `agent-validator run --enable-review <name> --context-file <task>` (or equivalent guidance — the comment is for humans discovering the entry by hand and SHALL be preserved on emission).

Opt-in entries SHALL NOT include `model` or `cli_preference` overrides unless a future requirement specifies otherwise; activation belongs to the orchestrator that supplies the `--enable-review` and `--context-file` flags at runtime.

Opt-in entries SHALL be written **in addition to** any entries chosen by the existing reviewer recommendation logic (primary/secondary/fallback).

#### Scenario: Fresh init with --enable-builtin writes opt-in entry alongside recommended entries
- **GIVEN** the user runs `agent-validate init --enable-builtin task-compliance`
- **AND** no `.validator/` directory exists
- **AND** local AI reviews are enabled and `github-copilot` is among the selected review CLIs (primary config)
- **WHEN** Phase 4 runs
- **THEN** `config.yml` SHALL contain the `code-quality` and `security-and-errors` entries from the primary config
- **AND** `config.yml` SHALL ALSO contain a `task-compliance` entry under the same `reviews:` list with `builtin: task-compliance` and `enabled: false`
- **AND** the `enabled: false` line SHALL carry a comment pointing the user at the `--enable-review task-compliance --context-file <task>` activation form

#### Scenario: Fresh init with --enable-builtin and no flag entries skipped
- **GIVEN** the user runs `agent-validate init` without `--enable-builtin`
- **AND** no `.validator/` directory exists
- **WHEN** Phase 4 runs
- **THEN** `config.yml` SHALL NOT contain any entry for `task-compliance` or `test-integrity`
- **AND** no entry SHALL be emitted with `enabled: false`

#### Scenario: Repeated --enable-builtin writes multiple opt-in entries
- **GIVEN** the user runs `agent-validate init --enable-builtin task-compliance --enable-builtin test-integrity`
- **AND** no `.validator/` directory exists
- **WHEN** Phase 4 runs
- **THEN** `config.yml` SHALL contain a `task-compliance` entry with `builtin: task-compliance` and `enabled: false`
- **AND** `config.yml` SHALL contain a `test-integrity` entry with `builtin: test-integrity` and `enabled: false`
- **AND** each `enabled: false` line SHALL carry its own activation-form comment

#### Scenario: --enable-builtin with --yes still writes the opt-in entry
- **GIVEN** the user runs `agent-validate init --yes --enable-builtin task-compliance`
- **AND** no `.validator/` directory exists
- **WHEN** init completes
- **THEN** `config.yml` SHALL contain the recommended entries chosen by `selectReviewConfig()` based on detected CLIs
- **AND** `config.yml` SHALL ALSO contain a `task-compliance` entry with `builtin: task-compliance` and `enabled: false`

#### Scenario: Comma-separated --enable-builtin values
- **GIVEN** the user runs `agent-validate init --enable-builtin task-compliance,test-integrity`
- **AND** no `.validator/` directory exists
- **WHEN** Phase 4 runs
- **THEN** init SHALL treat the value as two requested names and write both opt-in entries
- **AND** duplicate names SHALL be deduplicated before writing

### Requirement: Init rejects unknown or non-opt-in --enable-builtin values

The `init` command SHALL validate every `--enable-builtin <name>` value against the `optInBuiltIns` set before scaffolding. If any value is not the name of an opt-in built-in, init SHALL fail with an error naming the offending value and listing the accepted names. Validation SHALL run before any files are created or modified.

#### Scenario: Unknown name fails before scaffolding
- **GIVEN** the user runs `agent-validate init --enable-builtin gibberish`
- **WHEN** init starts
- **THEN** init SHALL exit with a non-zero status and an error message naming `gibberish` and listing the accepted opt-in built-in names
- **AND** no `.validator/` directory SHALL be created
- **AND** no plugin installation SHALL run

#### Scenario: Primary built-in name rejected
- **GIVEN** the user runs `agent-validate init --enable-builtin code-quality`
- **AND** `code-quality` is a primary built-in, not an opt-in built-in
- **WHEN** init starts
- **THEN** init SHALL exit with a non-zero status and an error message stating that `code-quality` is not an opt-in built-in
- **AND** the error SHALL list the accepted opt-in built-in names (currently `task-compliance` and `test-integrity`)

## MODIFIED Requirements

### Requirement: Init generates YAML review config with built-in reference

When local AI reviews are enabled, the `init` command SHALL write review entries in `config.yml` based on the reviewer recommendation logic rather than individual built-in review selection. Each review entry SHALL include `builtin`, and when applicable, `cli_preference` and `model` fields matching the recommended configurations. The `init` command SHALL NOT create `.validator/reviews/` directory files, SHALL NOT create the `.validator/reviews/` directory, and SHALL NOT create the `.validator/checks/` directory.

When `--enable-builtin <name>` is passed, init SHALL ALSO write one inline opt-in review entry per requested name with `builtin: <name>` and `enabled: false` (see `Init accepts --enable-builtin to scaffold opt-in built-in reviews`). Opt-in entries are appended to whatever the recommendation logic produced; they do not replace recommended entries.

#### Scenario: Primary config writes two-pass hybrid review entries
- **WHEN** the primary review config is selected (GitHub Copilot available)
- **THEN** `config.yml` SHALL contain a `code-quality` entry with `builtin: code-quality`, `cli_preference: [github-copilot]`, and `model: claude-sonnet-4.6`
- **AND** `config.yml` SHALL contain a `security-and-errors` entry with `builtin: security-and-errors`, `cli_preference: [github-copilot]`, and `model: gpt-5.3-codex`
- **AND** `.validator/reviews/` SHALL NOT be created
- **AND** `.validator/checks/` SHALL NOT be created

#### Scenario: Secondary config writes single combined review entry
- **WHEN** the secondary review config is selected (Codex only)
- **THEN** `config.yml` SHALL contain an `all-reviewers` entry with `builtin: all-reviewers` and `model: gpt-5.3-codex`
- **AND** no other review entries SHALL be present (apart from any opt-in entries requested via `--enable-builtin`)

#### Scenario: Fallback config writes combined review entry without overrides
- **WHEN** the fallback review config is selected (neither Copilot nor Codex)
- **THEN** `config.yml` SHALL contain an `all-reviewers` entry with `builtin: all-reviewers`
- **AND** no `model` or `cli_preference` SHALL be set on the review entry

#### Scenario: Init with --yes and Copilot detected writes primary config
- **WHEN** a user runs `agent-validate init --yes`
- **AND** `github-copilot` is detected as available
- **THEN** `config.yml` SHALL contain the primary config review entries (code-quality + security-and-errors with per-review overrides)

#### Scenario: Confirmed local AI review opt-out writes no review entries
- **WHEN** the user declines local AI reviews and confirms the opt-out
- **AND** `--enable-builtin` is NOT passed
- **THEN** `config.yml` SHALL contain no `reviews` entry under the generated root entry point
- **AND** `config.yml` SHALL still contain `cli.default_preference` populated from the selected development CLIs so the config remains valid
- **AND** `.validator/reviews/` SHALL NOT be created

#### Scenario: Local AI review opt-out plus --enable-builtin writes opt-in entries only
- **WHEN** the user declines local AI reviews and confirms the opt-out
- **AND** the user passes `--enable-builtin task-compliance`
- **THEN** `config.yml` SHALL contain a `reviews:` section under the root entry point containing only the `task-compliance` entry
- **AND** that entry SHALL have `builtin: task-compliance` and `enabled: false`
- **AND** no other review entries SHALL be present under the root entry point
- **AND** `cli.default_preference` SHALL still be populated from the selected development CLIs

### Requirement: Phase 4 scaffold skips when .validator/ exists

When `.validator/` already exists, Phase 4 SHALL skip entirely without modifying any files inside the directory. If `--enable-builtin <name>` was passed, init SHALL print a clearly visible warning naming each requested built-in, stating that the existing `.validator/config.yml` was not modified, and including the exact YAML block the user can paste into the appropriate `entry_points[].reviews:` list to take effect. The warning SHALL be emitted before init's normal post-init instructions so it is not lost in scroll.

#### Scenario: Fresh init creates .validator/ directory with selected reviews
- **GIVEN** the user runs `agent-validate init`
- **AND** no `.validator/` directory exists
- **AND** local AI reviews are enabled
- **WHEN** Phase 4 runs
- **THEN** `.validator/` SHALL be created with `config.yml` containing the root entry point and inline review entries chosen by reviewer recommendation logic
- **AND** the project-root `.gitignore` SHALL be updated to include `validator_logs`
- **AND** `.validator/reviews/` and `.validator/checks/` SHALL NOT be created

#### Scenario: Re-run skips .validator/ scaffolding
- **GIVEN** the user runs `agent-validate init`
- **AND** `.validator/` directory already exists
- **WHEN** Phase 4 runs
- **THEN** no files inside `.validator/` SHALL be created or modified
- **AND** init SHALL delegate to update logic (not run Phase 5 directly)

#### Scenario: Re-run with --enable-builtin warns and does not modify config
- **GIVEN** `.validator/` directory already exists
- **AND** the user runs `agent-validate init --enable-builtin task-compliance`
- **WHEN** Phase 4 runs
- **THEN** init SHALL NOT modify `.validator/config.yml`
- **AND** init SHALL print a warning naming `task-compliance` and stating that the entry was not added because `.validator/` already exists
- **AND** the warning SHALL include the exact YAML block (a `task-compliance` entry with `builtin: task-compliance` and `enabled: false` plus the activation-form comment) that the user can paste under an entry point's `reviews:` list
- **AND** init SHALL still delegate to update logic for the plugin refresh

#### Scenario: Re-run with multiple --enable-builtin values warns for each
- **GIVEN** `.validator/` directory already exists
- **AND** the user runs `agent-validate init --enable-builtin task-compliance --enable-builtin test-integrity`
- **WHEN** Phase 4 runs
- **THEN** init SHALL NOT modify `.validator/config.yml`
- **AND** init SHALL print a single warning that names both `task-compliance` and `test-integrity` and includes paste-ready YAML for both entries
