# Task: Update command + re-run delegation

## Goal

Add the `agent-gauntlet update` CLI command that detects where the plugin is installed and updates it, plus wire init re-run to delegate to the shared update logic. Also add plugin.json version sync to the release process.

## Background

The `update` command needs to: detect where the agent-gauntlet Claude plugin is installed (local project vs global), run the marketplace and plugin update commands, refresh Codex skills if installed, and report success with a restart reminder.

**Shared update logic module:** Create `src/commands/plugin-update.ts` containing the core update logic. Both the `update` command and init re-run import this module. The module should export a function like `runPluginUpdate(options?: { skipPrompts?: boolean })` that:
1. Runs `claude plugin list --json` to detect where agent-gauntlet is installed
2. If installed at project scope for the current project, targets that installation (closest scope wins)
3. If installed at user scope only, targets that installation
4. If installed at both scopes, targets project scope only
5. If not installed anywhere, exits with an error telling the user to run `agent-gauntlet init` first
6. Runs `claude plugin marketplace update agent-gauntlet` then `claude plugin update agent-gauntlet@pcaplan/agent-gauntlet`
7. If either command fails, reports the error and prints manual update instructions
8. On success, tells the user to restart any open agent sessions
9. Checks for Codex skills and refreshes them if found

**Plugin CLI wrapper additions:** The `src/plugin/claude-cli.ts` module (created in the previous task) needs additional functions:
- `listPlugins()` — runs `claude plugin list --json` and returns parsed JSON
- `updateMarketplace()` — runs `claude plugin marketplace update agent-gauntlet`
- `updatePlugin()` — runs `claude plugin update agent-gauntlet@pcaplan/agent-gauntlet`

**Codex skill detection:** Check for the `gauntlet-run` directory as a marker:
- Local: `.agents/skills/gauntlet-run/` in the current project
- Global: `$HOME/.agents/skills/gauntlet-run/`
If local Codex skills exist, update those. If only global exist, update global. If neither exist, skip silently. During update, changed skills are overwritten without prompting (update implies consent).

**Update command registration:** Create `src/commands/update.ts` with `registerUpdateCommand(program)`. Register it in `src/commands/index.ts` and `src/index.ts`. The command has no required arguments or options.

**Init re-run delegation:** In `src/commands/init.ts`, the re-run case (when `.gauntlet/` already exists) currently skips phases 2-4 and runs `installExternalFiles`. Replace that with a call to the shared `runPluginUpdate` function from `plugin-update.ts`. With `--yes`, pass `skipPrompts: true` so changed Codex files are overwritten without prompting.

**Release version sync:** Update the release command (`.claude/commands/release.md`) to sync `.claude-plugin/plugin.json` version after `changeset version` bumps `package.json`. Add a step between step 5 and step 6:
```bash
NEW_VERSION=$(node -p "require('./package.json').version")
jq --arg v "$NEW_VERSION" '.version = $v' .claude-plugin/plugin.json > .claude-plugin/plugin.json.tmp \
  && mv .claude-plugin/plugin.json.tmp .claude-plugin/plugin.json
```
Also add `.claude-plugin/plugin.json` to the `git add` in step 7.

**Key files:**
- `src/plugin/claude-cli.ts` — add `listPlugins`, `updateMarketplace`, `updatePlugin` functions
- `src/commands/plugin-update.ts` — create new, shared update logic
- `src/commands/update.ts` — create new, CLI command registration
- `src/commands/index.ts` — add `registerUpdateCommand` export
- `src/index.ts` — register the update command
- `src/commands/init.ts` — replace re-run logic with `runPluginUpdate` call
- `.claude/commands/release.md` — add plugin.json version sync step
- `test/commands/update.test.ts` — create new tests

**Constraints:**
- `claude plugin list --json` output is an array of plugin objects with `scope`, `projectPath`, and name fields — parse carefully
- The plugin identifier for update is `agent-gauntlet@pcaplan/agent-gauntlet` (name@marketplace format)
- Codex skill refresh during update overwrites without prompting (unlike init which prompts)
- The `runPluginUpdate` function must work when called from both the `update` command and from init re-run

## Spec

### Requirement: Plugin location detection

The `update` command SHALL detect where the agent-gauntlet plugin is installed by running `claude plugin list --json` and parsing the output.

#### Scenario: Plugin installed locally only
- **WHEN** the plugin is installed at project scope for the current project
- **THEN** update SHALL target the project-scope installation

#### Scenario: Plugin installed globally only
- **WHEN** the plugin is installed at user scope but not at project scope
- **THEN** update SHALL target the user-scope installation

#### Scenario: Plugin installed at both scopes
- **WHEN** the plugin is installed at both project and user scope
- **THEN** update SHALL target the project-scope installation only (closest scope wins)

#### Scenario: Plugin not installed anywhere
- **WHEN** the plugin is not found in the plugin list
- **THEN** update SHALL exit with an error message telling the user to run `agent-gauntlet init` first

### Requirement: Plugin update execution

The `update` command SHALL update the plugin by running `claude plugin marketplace update agent-gauntlet` followed by `claude plugin update agent-gauntlet@pcaplan/agent-gauntlet`.

#### Scenario: Update succeeds
- **WHEN** both marketplace update and plugin update commands succeed
- **THEN** update SHALL report success
- **AND** SHALL tell the user to restart any open agent sessions

#### Scenario: Update fails
- **WHEN** either update command fails
- **THEN** update SHALL report the error and print manual update instructions

### Requirement: Codex skill update

The `update` command SHALL update Codex skills if they are installed, using the same file-copy and checksum logic as init.

#### Scenario: Codex skills installed locally
- **WHEN** `.agents/skills/` exists in the current project with gauntlet skills
- **THEN** update SHALL refresh those skills using checksum comparison
- **AND** changed skills SHALL be overwritten (update implies consent)

#### Scenario: Codex skills installed globally
- **WHEN** `$HOME/.agents/skills/` contains gauntlet skills
- **AND** no local Codex skills exist
- **THEN** update SHALL refresh the global Codex skills

#### Scenario: No Codex skills installed
- **WHEN** no gauntlet skills are found in either Codex skill location
- **THEN** update SHALL skip Codex skill update silently

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

## Done When

- `agent-gauntlet update` detects plugin location and updates it end-to-end
- `agent-gauntlet update` refreshes Codex skills when found
- `agent-gauntlet update` exits with error when plugin not installed
- `agent-gauntlet init` re-run (`.gauntlet/` exists) delegates to update logic
- Release command syncs `.claude-plugin/plugin.json` version
- Tests covering the above scenarios pass
