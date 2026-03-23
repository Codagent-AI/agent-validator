# init-config Specification (Delta)

## Purpose
Update post-init instructions and CLI classification to treat Copilot CLI as a native, skill-capable CLI.

## MODIFIED Requirements

### Requirement: Init outputs next-step message

After completing setup, `init` SHALL print context-aware instructions based on the selected development CLIs. Native CLI users (Claude Code, Cursor, GitHub Copilot) SHALL receive `/validator-setup` slash-command instructions. Non-native CLI users SHALL receive `@file_path` reference instructions. Codex users SHALL receive Codex-native `.agents/skills/` path references.

#### Scenario: Claude Code user instructions
- **GIVEN** the user selected `claude` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/validator-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Validator will run."

#### Scenario: Cursor user instructions
- **GIVEN** the user selected `cursor` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/validator-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Validator will run."

#### Scenario: GitHub Copilot user instructions
- **GIVEN** the user selected `github-copilot` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/validator-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Validator will run."

#### Scenario: Codex user instructions
- **GIVEN** the user selected `codex` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL reference skills using `.agents/skills/` paths
- **AND** the output SHALL list all available skills with `.agents/skills/<skill-name>/SKILL.md` syntax

#### Scenario: Non-native non-codex CLI user instructions
- **GIVEN** the user selected a non-native, non-codex CLI (e.g., `gemini`) as a development CLI
- **AND** the user did NOT select `claude`, `cursor`, `github-copilot`, or `codex`
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include `@.claude/skills/` path references (existing behavior)

#### Scenario: Mixed CLI selection instructions
- **GIVEN** the user selected both `claude` and `codex` as development CLIs
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include BOTH the `/validator-setup` instructions AND the Codex `.agents/skills/` instructions
- **AND** the instructions SHALL be grouped by CLI type

#### Scenario: --yes flag still shows instructions
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** the init command completes (Phase 6)
- **THEN** the post-init instructions SHALL still be displayed (instructions are never skipped)

### Requirement: Non-Claude non-Codex CLIs keep current behavior

CLIs that are not Claude, Codex, Cursor, or GitHub Copilot SHALL continue using the existing skill-copy installation approach during init.

#### Scenario: Gemini selected copies skills to .claude/skills/
- **GIVEN** the user selects `gemini` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** skills SHALL be copied to `.claude/skills/` with `@file_path` references (existing behavior)

#### Scenario: GitHub Copilot is NOT in the file-copy bucket
- **GIVEN** the user selects `github-copilot` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** skills SHALL NOT be copied to `.claude/skills/` or `.github/skills/` via file copy
- **AND** the plugin install mechanism SHALL be used instead
