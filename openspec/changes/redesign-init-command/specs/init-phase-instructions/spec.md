# init-phase-instructions

Spec: init-config

## MODIFIED Requirements

### Requirement: Init outputs next-step message

After completing setup, `init` SHALL print context-aware instructions based on the selected development CLIs. Native CLI users (Claude Code, Cursor) SHALL receive `/gauntlet-setup` slash-command instructions. Non-native CLI users SHALL receive `@file_path` reference instructions.

#### Scenario: Claude Code user instructions
- **GIVEN** the user selected `claude` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/gauntlet-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."

#### Scenario: Cursor user instructions
- **GIVEN** the user selected `cursor` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/gauntlet-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."

#### Scenario: Non-native CLI user instructions
- **GIVEN** the user selected `codex` as a development CLI
- **AND** the user did NOT select `claude` or `cursor`
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, reference the setup skill in your CLI: `@.claude/skills/gauntlet-setup/SKILL.md`. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."
- **AND** the output SHALL list all available skills with `@file_path` syntax and one-line descriptions

#### Scenario: Mixed CLI selection instructions
- **GIVEN** the user selected both `claude` and `codex` as development CLIs
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include BOTH the `/gauntlet-setup` instructions AND the `@file_path` instructions
- **AND** the instructions SHALL be grouped by CLI type (native vs non-native)

#### Scenario: --yes flag still shows instructions
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **WHEN** the init command completes (Phase 6)
- **THEN** the post-init instructions SHALL still be displayed (instructions are never skipped)
