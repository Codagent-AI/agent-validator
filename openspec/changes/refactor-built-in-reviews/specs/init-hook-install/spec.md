## REMOVED Requirements

### Requirement: Init uses built-in review instead of creating review file
**Reason**: Replaced by the new requirement below. Instead of referencing `built-in:code-quality` directly in `config.yml`, init now generates a YAML review config file that references the built-in prompt.
**Migration**: No user migration needed; `init` now creates `.gauntlet/reviews/code-quality.yml` with `builtin: code-quality` and references `code-quality` in `config.yml`.

## ADDED Requirements

### Requirement: Init generates YAML review config with built-in reference
The `init` command SHALL generate a `.gauntlet/reviews/code-quality.yml` file that references the built-in code-quality review prompt. The generated `config.yml` SHALL reference `code-quality` (the file-based review name) in entry point reviews.

#### Scenario: Default init creates YAML review config
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/reviews/code-quality.yml` SHALL be created with content referencing `builtin: code-quality`
- **AND** the YAML file SHALL include default settings (`num_reviews: 2`)
- **AND** `.gauntlet/config.yml` entry points SHALL reference `code-quality` (not `built-in:code-quality`)

#### Scenario: Init with --yes flag creates YAML review config
- **GIVEN** a user runs `agent-gauntlet init --yes`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/reviews/code-quality.yml` SHALL be created with content referencing `builtin: code-quality`
- **AND** the YAML file SHALL include default settings (`num_reviews: 2`)
- **AND** `.gauntlet/config.yml` entry points SHALL reference `code-quality` (not `built-in:code-quality`)
