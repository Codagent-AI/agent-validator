## ADDED Requirements

### Requirement: Init scaffolds model defaults for proxy adapters
The `init` command SHALL include a `model` field in the adapter configuration defaults for Cursor and GitHub Copilot adapters. These adapters proxy requests to upstream LLMs and benefit from an explicit model default. Adapters that are themselves LLM providers (Claude, Codex, Gemini) SHALL NOT have a `model` default.

#### Scenario: Cursor adapter default includes model
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** `cursor` is selected as a review CLI
- **WHEN** `.gauntlet/config.yml` is generated
- **THEN** the `cli.adapters.cursor` section SHALL include `model: codex`

#### Scenario: GitHub Copilot adapter default includes model
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** `github-copilot` is selected as a review CLI
- **WHEN** `.gauntlet/config.yml` is generated
- **THEN** the `cli.adapters.github-copilot` section SHALL include `model: codex`

#### Scenario: Claude adapter does not include model default
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** `claude` is selected as a review CLI
- **WHEN** `.gauntlet/config.yml` is generated
- **THEN** the `cli.adapters.claude` section SHALL NOT include a `model` field

#### Scenario: Codex adapter does not include model default
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** `codex` is selected as a review CLI
- **WHEN** `.gauntlet/config.yml` is generated
- **THEN** the `cli.adapters.codex` section SHALL NOT include a `model` field

#### Scenario: Gemini adapter does not include model default
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** `gemini` is selected as a review CLI
- **WHEN** `.gauntlet/config.yml` is generated
- **THEN** the `cli.adapters.gemini` section SHALL NOT include a `model` field
