## MODIFIED Requirements

### Requirement: Init uses non-interactive config defaults

The `init` command SHALL present interactive prompts for development CLI selection, installation scope (local vs global), review CLI selection, and `num_reviews` configuration. All other config values SHALL remain non-interactive with auto-detected defaults.

#### Scenario: Development CLI multi-select prompt
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected as available
- **WHEN** Phase 2 begins
- **THEN** the user SHALL be presented with a multi-select prompt listing all detected CLIs
- **AND** the prompt SHALL include the explanation: "Select your development CLI(s). These are the main tools you work in."
- **AND** at least one CLI must be selected to proceed

#### Scenario: Installation scope prompt
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the user has selected development CLIs in Phase 2
- **THEN** the user SHALL be prompted to choose installation scope: local (project) or global (user)

#### Scenario: Development CLI with hook support
- **GIVEN** the user selects `claude` as a development CLI
- **WHEN** Phase 2 completes
- **THEN** `claude` SHALL be marked for plugin installation (hooks are now part of the plugin)

#### Scenario: Development CLI without hook support
- **GIVEN** the user selects `codex` as a development CLI
- **WHEN** Phase 2 completes
- **THEN** the output SHALL display a warning: "[CLI] doesn't support hooks yet, skipping hook installation"
- **AND** no hook installation SHALL be queued for that CLI

#### Scenario: Review CLI multi-select prompt
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected as available
- **WHEN** Phase 3 begins
- **THEN** the user SHALL be presented with a multi-select prompt listing all detected CLIs
- **AND** the prompt SHALL include the explanation: "Select your reviewer CLI(s). These are the CLIs that will be used for AI code reviews."
- **AND** at least one CLI must be selected to proceed

#### Scenario: Review CLIs set default_preference
- **GIVEN** the user selects `claude` and `codex` as review CLIs
- **WHEN** the config is generated
- **THEN** `cli.default_preference` SHALL contain `["claude", "codex"]` (in the user's selection order)

#### Scenario: Single review CLI sets num_reviews automatically
- **GIVEN** the user selects exactly 1 review CLI
- **WHEN** Phase 3 completes
- **THEN** `num_reviews` SHALL be set to `1` in the default review config
- **AND** no prompt for `num_reviews` SHALL be shown

#### Scenario: Multiple review CLIs prompt for num_reviews
- **GIVEN** the user selects 3 review CLIs
- **WHEN** Phase 3 completes
- **THEN** the user SHALL be prompted: "How many of these CLIs would you like to run on every review?"
- **AND** the valid range SHALL be 1 to 3
- **AND** the selected value SHALL be written as `num_reviews` in the default review config

#### Scenario: Built-in reviewer announcement
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** Phase 3 completes
- **THEN** the output SHALL display: "Agent Gauntlet's built-in code quality reviewer will be installed."

#### Scenario: No base branch prompt
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the init command runs
- **THEN** base branch SHALL be auto-detected from the git remote (falling back to `origin/main` if detection fails)
- **AND** no prompt for base branch SHALL be shown

#### Scenario: No lint or test command prompts
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the init command runs
- **THEN** no prompts for lint or test commands SHALL be shown
- **AND** no check YAML files SHALL be created by init

### Requirement: --yes flag skips all interactive prompts with defaults

When `--yes` is passed, `init` SHALL skip all interactive prompts and apply default selections.

#### Scenario: --yes selects all detected CLIs as development CLIs
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected
- **WHEN** Phase 2 runs
- **THEN** all detected CLIs SHALL be selected as development CLIs without prompting

#### Scenario: --yes defaults to local scope
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **WHEN** Phase 2 runs
- **THEN** installation scope SHALL default to local (project) without prompting

#### Scenario: --yes selects all detected CLIs as review CLIs
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected
- **WHEN** Phase 3 runs
- **THEN** all detected CLIs SHALL be added to `cli.default_preference`
- **AND** `num_reviews` SHALL be set to the number of detected CLIs

#### Scenario: --yes overwrites changed files without asking
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** a Codex skill file exists with a different checksum
- **WHEN** Phase 5 runs
- **THEN** the file SHALL be overwritten without prompting

### Requirement: Init installs Claude plugin instead of copying skills

When Claude is a selected development CLI, init SHALL install the agent-gauntlet Claude plugin instead of copying skill files to `.claude/skills/`.

#### Scenario: Claude selected installs plugin at local scope
- **GIVEN** the user selects `claude` as a development CLI
- **AND** the user selects local scope
- **WHEN** Phase 5 runs
- **THEN** init SHALL run `claude plugin marketplace add pcaplan/agent-gauntlet`
- **AND** init SHALL run `claude plugin install agent-gauntlet --scope project`
- **AND** no skill files SHALL be copied to `.claude/skills/`

#### Scenario: Claude selected installs plugin at global scope
- **GIVEN** the user selects `claude` as a development CLI
- **AND** the user selects global scope
- **WHEN** Phase 5 runs
- **THEN** init SHALL run `claude plugin install agent-gauntlet --scope user`
- **AND** no skill files SHALL be copied to `.claude/skills/`

### Requirement: Init installs Codex skills based on scope

When Codex is a selected development CLI, init SHALL install skills to the appropriate directory based on the selected scope.

#### Scenario: Codex selected with local scope
- **GIVEN** the user selects `codex` as a development CLI
- **AND** the user selects local scope
- **WHEN** Phase 5 runs
- **THEN** gauntlet skills SHALL be copied to `.agents/skills/<skill-name>/`

#### Scenario: Codex selected with global scope
- **GIVEN** the user selects `codex` as a development CLI
- **AND** the user selects global scope
- **WHEN** Phase 5 runs
- **THEN** gauntlet skills SHALL be copied to `$HOME/.agents/skills/<skill-name>/`

#### Scenario: Codex skill checksum matches skips update
- **GIVEN** a skill already exists at the target Codex skill location
- **WHEN** its checksum matches the source skill
- **THEN** the skill SHALL be skipped without prompting

#### Scenario: Codex skill checksum differs prompts for overwrite
- **GIVEN** a skill already exists at the target Codex skill location
- **WHEN** its checksum differs from the source skill
- **THEN** the user SHALL be prompted to overwrite (unless `--yes` is passed)

### Requirement: Re-run delegates to update

When `.gauntlet/` already exists, the init command SHALL skip interactive phases and delegate to the update logic.

#### Scenario: Re-run skips prompts and calls update
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** the `.gauntlet/` directory already exists
- **WHEN** Phase 1 completes CLI detection
- **THEN** Phases 2-4 SHALL be skipped
- **AND** init SHALL execute the same logic as `agent-gauntlet update`

#### Scenario: Re-run with --yes flag
- **GIVEN** `.gauntlet/` already exists
- **WHEN** `agent-gauntlet init --yes` runs
- **THEN** Phases 2-4 SHALL be skipped
- **AND** update logic SHALL run with changed files overwritten without prompting

### Requirement: Non-Claude non-Codex CLIs keep current behavior

CLIs that are not Claude or Codex SHALL continue using the existing skill-copy installation approach during init.

#### Scenario: Gemini selected copies skills to .claude/skills/
- **GIVEN** the user selects `gemini` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** skills SHALL be copied to `.claude/skills/` with `@file_path` references (existing behavior)

#### Scenario: Cursor selected copies skills to .claude/skills/
- **GIVEN** the user selects `cursor` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** skills SHALL be installed using the existing Cursor adapter behavior

## REMOVED Requirements

### Requirement: Init installs skills to Codex skill directory
**Reason**: Replaced by "Init installs Codex skills based on scope" which adds global scope support
**Migration**: Existing `.agents/skills/` installations continue to work; re-run init to adopt new scope behavior

### Requirement: Skill overwrite prompt supports update-all option
**Reason**: Claude skills no longer use file copy (plugin handles it). Codex-only update-all is lower value.
**Migration**: Use `--yes` flag for non-interactive updates
