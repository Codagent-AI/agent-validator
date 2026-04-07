## MODIFIED Requirements

### Requirement: Init generates YAML review config with built-in reference
The `init` command SHALL write review entries in `config.yml` based on the reviewer recommendation logic rather than user selection. Each review entry SHALL include `builtin`, and when applicable, `cli_preference` and `model` fields matching the recommended configurations. The `init` command SHALL NOT create `.validator/reviews/` directory files, SHALL NOT create the `.validator/reviews/` directory, and SHALL NOT create the `.validator/checks/` directory.

#### Scenario: Primary config writes two-pass hybrid review entries
- **WHEN** the primary review config is selected (GitHub Copilot available)
- **THEN** `config.yml` SHALL contain a `code-quality` entry with `builtin: code-quality`, `cli_preference: [github-copilot]`, and `model: claude-sonnet-4.6`
- **AND** `config.yml` SHALL contain a `security-and-errors` entry with `builtin: security-and-errors`, `cli_preference: [github-copilot]`, and `model: gpt-5.3-codex`
- **AND** `.validator/reviews/` SHALL NOT be created
- **AND** `.validator/checks/` SHALL NOT be created

#### Scenario: Secondary config writes single combined review entry
- **WHEN** the secondary review config is selected (Codex only)
- **THEN** `config.yml` SHALL contain an `all-reviewers` entry with `builtin: all-reviewers` and `model: gpt-5.3-codex`
- **AND** no other review entries SHALL be present

#### Scenario: Fallback config writes combined review entry without overrides
- **WHEN** the fallback review config is selected (neither Copilot nor Codex)
- **THEN** `config.yml` SHALL contain an `all-reviewers` entry with `builtin: all-reviewers`
- **AND** no `model` or `cli_preference` SHALL be set on the review entry

#### Scenario: Init with --yes and Copilot detected writes primary config
- **WHEN** a user runs `agent-validate init --yes`
- **AND** `github-copilot` is detected as available
- **THEN** `config.yml` SHALL contain the primary config review entries (code-quality + security-and-errors with per-review overrides)
