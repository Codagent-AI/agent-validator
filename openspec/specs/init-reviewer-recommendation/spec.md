# init-reviewer-recommendation Specification

## Purpose
TBD - created by archiving change init-reviewer-recommendations. Update Purpose after archive.
## Requirements
### Requirement: Init recommends review config based on detected reviewer CLIs
The init command SHALL select a review configuration automatically based on which reviewer CLIs the user selected in `promptReviewCLIs()`, following this priority:

1. If `github-copilot` is among the selected review CLIs → **primary config**: two-pass hybrid with `code-quality` (Sonnet) and `security-and-errors` (GPT)
2. Else if `codex` is among the selected review CLIs → **secondary config**: single `all-reviewers` pass (GPT)
3. Else → **fallback config**: single `all-reviewers` pass (no model or cli_preference overrides)

When multiple CLIs are selected, `github-copilot` SHALL take priority for determining the review config.

#### Scenario: Copilot selected as review CLI
- **WHEN** user selects `github-copilot` as a review CLI
- **THEN** the primary config SHALL be used
- **AND** two review entries SHALL be generated: `code-quality` with `cli_preference: [github-copilot]` and `model: claude-sonnet-4.6`, and `security-and-errors` with `cli_preference: [github-copilot]` and `model: gpt-5.3-codex`

#### Scenario: Both Copilot and Codex selected
- **WHEN** user selects both `github-copilot` and `codex` as review CLIs
- **THEN** the primary config SHALL be used (Copilot wins)

#### Scenario: Codex selected without Copilot
- **WHEN** user selects `codex` as a review CLI without `github-copilot`
- **THEN** the secondary config SHALL be used
- **AND** a single `all-reviewers` review entry SHALL be generated with `model: gpt-5.3-codex`

#### Scenario: Neither Copilot nor Codex selected
- **WHEN** user selects only CLIs other than `github-copilot` and `codex` (e.g. `gemini`)
- **THEN** the fallback config SHALL be used
- **AND** a single `all-reviewers` review entry SHALL be generated with no model or cli_preference overrides

#### Scenario: --yes flag follows same recommendation logic
- **WHEN** `--yes` flag is passed
- **THEN** the same recommendation logic SHALL apply based on detected CLIs
- **AND** no additional prompts SHALL be shown for review configuration

### Requirement: Init prints explanation of selected review config
After selecting the review configuration, init SHALL print a message explaining which configuration was chosen and why.

#### Scenario: Primary config explanation
- **WHEN** primary config is selected
- **THEN** output SHALL include mention of two-pass hybrid reviews and GitHub Copilot availability

#### Scenario: Secondary config explanation
- **WHEN** secondary config is selected
- **THEN** output SHALL include mention of combined all-reviewers pass and Codex

#### Scenario: Fallback config explanation
- **WHEN** fallback config is selected
- **THEN** output SHALL indicate that the all-reviewers combined prompt is being used

### Requirement: Init does not prompt for individual built-in review selection
The `promptBuiltInReviews()` interactive prompt SHALL be removed from the init flow. Users SHALL NOT be asked to individually select which built-in reviews to enable.

#### Scenario: Interactive init skips built-in review selection
- **WHEN** init runs interactively (no `--yes` flag)
- **THEN** no multi-select checkbox for built-in reviews SHALL be presented

#### Scenario: --yes init skips built-in review selection
- **WHEN** init runs with `--yes`
- **THEN** no built-in review selection SHALL occur

