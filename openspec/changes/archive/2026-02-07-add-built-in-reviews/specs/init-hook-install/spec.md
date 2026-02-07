## ADDED Requirements

### Requirement: Init uses built-in review instead of creating review file
The `init` command SHALL reference `built-in:code-quality` in the generated `config.yml` instead of creating `.gauntlet/reviews/code-quality.md`. The `.gauntlet/reviews/` directory SHALL still be created (for users who add custom reviews), but no default review file SHALL be written.

#### Scenario: Default init with built-in review
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `config.yml` SHALL contain `built-in:code-quality` in the entry_points reviews list
- **AND** `.gauntlet/reviews/` directory SHALL exist (empty)
- **AND** `.gauntlet/reviews/code-quality.md` SHALL NOT be created

#### Scenario: Init with --yes flag uses built-in review
- **GIVEN** the user runs `agent-gauntlet init -y`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `config.yml` SHALL contain `built-in:code-quality` in the entry_points reviews list
- **AND** `.gauntlet/reviews/` directory SHALL exist (empty)
- **AND** `.gauntlet/reviews/code-quality.md` SHALL NOT be created
