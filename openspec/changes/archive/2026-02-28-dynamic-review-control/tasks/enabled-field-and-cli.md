# Task: Implement enabled field config and CLI override

## Goal

Add `enabled: z.boolean().default(true)` to review schemas, propagate through config loading, add `--enable-review <name>` CLI option to `run` and `review` commands, and filter disabled reviews in job generation.

## Background

The review system has three Zod schemas in `src/config/schema.ts`:
- `reviewGateSchema` — the internal review gate config
- `reviewPromptFrontmatterSchema` — markdown frontmatter parsing
- `reviewYamlSchema` — YAML review file parsing

And one TypeScript interface in `src/config/types.ts`:
- `LoadedReviewGateConfig` — the fully loaded review config used downstream

The config loader in `src/config/validate-reviews.ts` builds `LoadedReviewGateConfig` objects from parsed frontmatter/YAML — it must propagate the `enabled` value.

The CLI commands are registered in:
- `src/commands/run.ts` — `registerRunCommand()` using Commander
- `src/commands/review.ts` — `registerReviewCommand()` (delegates to `src/commands/gate-command.ts`)

The run executor at `src/core/run-executor.ts` defines `ExecuteRunOptions` with: `baseBranch`, `gate`, `commit`, `uncommitted`, `cwd`, `checkInterval`.

`JobGenerator` in `src/core/job.ts` has `collectReviewJobs()` which already filters via `shouldRunGate()` for `run_in_ci`/`run_locally`. The new `enabled` filter goes right after that check.

`JobGenerator` is instantiated in `src/core/run-executor-helpers.ts` inside `detectAndPrepareChanges` — the `enableReviews` set needs to reach there.

Commander's variadic option syntax `<name...>` collects repeated flags into an array.

## Spec

### Requirement: Reviews support enabled attribute
All review file formats (`.md` frontmatter and `.yml`/`.yaml`) MUST support an `enabled` boolean attribute that defaults to `true`. When `enabled` is `false`, the review is opt-in.

#### Scenario: YAML review with builtin and no other settings uses schema defaults
- **WHEN** a file `.gauntlet/reviews/code-quality.yml` with only `builtin: code-quality` is loaded
- **THEN** `enabled` defaults to true

#### Scenario: YAML review with enabled false
- **WHEN** a file `.gauntlet/reviews/task-compliance.yml` with `builtin: code-quality` and `enabled: false` is loaded
- **THEN** the review "task-compliance" is available with `enabled` set to `false`

#### Scenario: Markdown review with enabled false in frontmatter
- **WHEN** a file `.gauntlet/reviews/task-compliance.md` with frontmatter containing `enabled: false` is loaded
- **THEN** the review "task-compliance" is available with `enabled` set to `false`

### Requirement: Review enabled filtering at job generation
The system SHALL skip reviews with `enabled: false` during job generation unless the review name appears in the `enableReviews` set provided via CLI options.

#### Scenario: Disabled review skipped when no override provided
- **WHEN** a review has `enabled: false` in its config
- **AND** no `--enable-review` flag names that review
- **THEN** the review SHALL NOT generate any jobs

#### Scenario: Disabled review activated via CLI override
- **WHEN** a review has `enabled: false` in its config
- **AND** `--enable-review <name>` is passed on the CLI matching that review
- **THEN** the review SHALL generate jobs as if it were enabled

#### Scenario: Enabled reviews unaffected by override flag
- **WHEN** a review has `enabled: true` (or no `enabled` field)
- **AND** `--enable-review` is passed for a different review
- **THEN** the review SHALL still generate jobs normally

#### Scenario: Multiple reviews activated via repeated flag
- **WHEN** `--enable-review task-compliance --enable-review security` is passed
- **THEN** both reviews SHALL be activated even if their configs have `enabled: false`

### Requirement: Enable-review CLI option on run and review commands
The `run` and `review` commands SHALL accept a repeatable `--enable-review <name>` option (short: `-e`) that activates disabled reviews for that invocation.

#### Scenario: Single review enabled via CLI
- **WHEN** `agent-gauntlet run --enable-review task-compliance` is invoked
- **THEN** the `task-compliance` review SHALL be activated for that run

#### Scenario: Enable-review on review command
- **WHEN** `agent-gauntlet review --enable-review task-compliance` is invoked
- **THEN** the `task-compliance` review SHALL be activated for that review-only run

#### Scenario: Enable-review with unknown name is silently ignored
- **WHEN** `agent-gauntlet run --enable-review nonexistent` is invoked
- **AND** no review named `nonexistent` is configured
- **THEN** the run SHALL proceed normally without error

## Done When

Tests covering the above scenarios pass. The `enabled` field is in all three schemas (defaulting to `true`), the `LoadedReviewGateConfig` interface, propagated through `validate-reviews.ts`, and the `--enable-review` option is accepted by both `run` and `review` commands, threaded through `ExecuteRunOptions`, and used in `JobGenerator.collectReviewJobs()`.
