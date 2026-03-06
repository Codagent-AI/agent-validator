# Task: Plugin infrastructure + init rewrite

## Goal

Create the static plugin files, the Claude CLI wrapper module, and rewrite `init` to install the agent-gauntlet Claude plugin (with local/global scope prompt) instead of copying skill files. Simplify hook installation (hooks now live in the plugin). Support global Codex skill installation.

## Background

Agent-gauntlet currently copies 9 skill directories into `.claude/skills/` and writes hook entries into `.claude/settings.local.json` during `init`. This task replaces that with Claude plugin-based delivery.

**Plugin CLI wrapper module:** Create `src/plugin/claude-cli.ts` with typed functions wrapping `claude plugin *` shell commands. The functions needed for this task:
- `addMarketplace()` — runs `claude plugin marketplace add pcaplan/agent-gauntlet`
- `installPlugin(scope: 'user' | 'project')` — runs `claude plugin install agent-gauntlet --scope <scope>`

Each function should shell out via `execFileSync` or `execFile`, return success/failure, and capture stderr for error reporting. Both commands are run unconditionally (no pre-checks).

**Static plugin files:**
- `.claude-plugin/plugin.json` — manifest with `name: "agent-gauntlet"`, `version`, `description`, `license`. Version must match `package.json` (will be automated in a later task; for now, set it manually to the current version `1.2.2`).
- `hooks/hooks.json` — static hook definitions for start and stop hooks. Follow the same format as the superpowers plugin. The file should contain:
  - A `hooks.Stop` array with a stop hook entry: `{ "hooks": [{ "type": "command", "command": "agent-gauntlet stop-hook", "timeout": 300 }] }`
  - A `hooks.SessionStart` array with a start hook entry: `{ "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "agent-gauntlet start-hook", "async": false }] }`

**package.json:** Add `.claude-plugin` and `hooks` to the `files` array so they ship with the npm package.

**Init rewrite (`src/commands/init.ts`):**

The current init flow is:
1. Phase 1: Detect available CLIs
2. Phase 2: Prompt for dev CLIs (if `.gauntlet/` doesn't exist)
3. Phase 3: Prompt for review CLIs (if `.gauntlet/` doesn't exist)
4. Phase 4: Scaffold `.gauntlet/` directory (if it doesn't exist)
5. Phase 5: Install skills to `.claude/skills/` + `.agents/skills/`, install hooks to `settings.local.json`
6. Print post-init instructions

Changes needed:
- **Phase 2:** After dev CLI selection, add a new prompt asking the user to choose installation scope: local (project) or global (user). Use `@inquirer/prompts` `select` with two choices. With `--yes`, default to local scope.
- **Phase 5 (Claude):** Instead of copying skills to `.claude/skills/`, run `claude plugin marketplace add pcaplan/agent-gauntlet` then `claude plugin install agent-gauntlet --scope <scope>`. If either command fails, warn the user, print manual installation instructions (`claude plugin marketplace add pcaplan/agent-gauntlet` and `claude plugin install agent-gauntlet --scope <scope>`), and continue with remaining init steps. Do NOT write any hook entries to `settings.local.json` — hooks are now in the plugin's `hooks/hooks.json`.
- **Phase 5 (Codex):** When local scope is selected, install to `.agents/skills/<skill-name>/` (same as today). When global scope is selected, install to `$HOME/.agents/skills/<skill-name>/` instead. Use the existing `installSkillsWithChecksums` function but pass the appropriate base directory.
- **Phase 5 (Other CLIs):** Gemini, Cursor, GitHub Copilot keep existing skill-copy behavior (copy to `.claude/skills/` with `@file_path` references).
- **Re-run case:** When `.gauntlet/` already exists, skip phases 2-4 and delegate to update logic. Implement a simple inline version: re-run plugin install for Claude (detect scope from `claude plugin list --json` or default to user) and refresh Codex skills.

**Init prompts (`src/commands/init-prompts.ts`):** Add a `promptInstallScope` function that returns `'user' | 'project'`. With `skipPrompts`, return `'project'` (local default).

**Init hooks simplification (`src/commands/init-hooks.ts`):** The `installHooksForAdapters` function is called from `installExternalFiles` in `init.ts`. For Claude, hooks are now in the plugin — stop calling hook installation for Claude. Remove Cursor hook installation entirely (deferred). The remaining hook-related code can stay for now but won't be called for Claude or Cursor.

**Re-exports in `init.ts`:** The file currently re-exports `installStopHook`, `installStartHook`, `installCursorStopHook`, `installCursorStartHook`, `mergeHookConfig` from `init-hooks.ts`. Check if these are used anywhere else in the codebase. If not, remove the re-exports.

**Key files:**
- `.claude-plugin/plugin.json` — create new
- `hooks/hooks.json` — create new
- `package.json` — edit `files` array
- `src/plugin/claude-cli.ts` — create new
- `src/commands/init.ts` — major rewrite of `installExternalFiles` and `runInit`
- `src/commands/init-prompts.ts` — add `promptInstallScope`
- `src/commands/init-hooks.ts` — simplify (stop calling for Claude/Cursor)
- `test/commands/init.test.ts` — update tests for new behavior

**Constraints:**
- The `claude` binary is assumed to be on PATH (same as `agent-gauntlet` itself)
- Plugin install commands are run unconditionally — no pre-check for marketplace or existing installation
- On failure, warn and continue — never abort init due to plugin install failure
- Codex checksum logic is unchanged — reuse `computeSkillChecksum` and `installSkillsWithChecksums`
- Non-Claude, non-Codex CLIs keep their existing behavior untouched

## Spec

### Requirement: Plugin marketplace registration

The `init` command SHALL run `claude plugin marketplace add pcaplan/agent-gauntlet` before attempting plugin installation. The command SHALL be run unconditionally (no pre-check).

#### Scenario: Marketplace add succeeds
- **WHEN** `init` runs the marketplace add command
- **AND** the command succeeds
- **THEN** init SHALL proceed to plugin installation

#### Scenario: Marketplace add fails
- **WHEN** `init` runs the marketplace add command
- **AND** the command fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions (the marketplace add and plugin install commands)
- **AND** SHALL continue with remaining init steps (Codex skills, other CLIs)

### Requirement: Plugin installation with scope

The `init` command SHALL install the agent-gauntlet Claude plugin using `claude plugin install agent-gauntlet --scope <scope>`, where scope is `user` (global) or `project` (local) based on the user's selection.

#### Scenario: User selects local scope
- **WHEN** the user selects local/project installation
- **THEN** init SHALL run `claude plugin install agent-gauntlet --scope project`

#### Scenario: User selects global scope
- **WHEN** the user selects global installation
- **THEN** init SHALL run `claude plugin install agent-gauntlet --scope user`

#### Scenario: Plugin already installed at different scope
- **WHEN** the plugin is already installed at a different scope
- **THEN** init SHALL install at the requested scope regardless (both installations coexist)

#### Scenario: Plugin install command fails
- **WHEN** `claude plugin install` fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions
- **AND** SHALL continue with remaining init steps

### Requirement: Plugin manifest

The npm package SHALL include a `.claude-plugin/plugin.json` manifest so the package can be discovered as a Claude Code plugin.

#### Scenario: Plugin manifest contents
- **WHEN** the package is published
- **THEN** `.claude-plugin/plugin.json` SHALL contain `name`, `version`, `description`, and `license` fields
- **AND** the `version` field SHALL match the version in `package.json`

### Requirement: Init uses non-interactive config defaults

The `init` command SHALL present interactive prompts for development CLI selection, installation scope (local vs global), review CLI selection, and `num_reviews` configuration. All other config values SHALL remain non-interactive with auto-detected defaults.

#### Scenario: Installation scope prompt
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the user has selected development CLIs in Phase 2
- **THEN** the user SHALL be prompted to choose installation scope: local (project) or global (user)

#### Scenario: Development CLI with hook support
- **GIVEN** the user selects `claude` as a development CLI
- **WHEN** Phase 2 completes
- **THEN** `claude` SHALL be marked for plugin installation (hooks are now part of the plugin)

### Requirement: --yes flag skips all interactive prompts with defaults

When `--yes` is passed, `init` SHALL skip all interactive prompts and apply default selections.

#### Scenario: --yes defaults to local scope
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **WHEN** Phase 2 runs
- **THEN** installation scope SHALL default to local (project) without prompting

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

### Requirement: Hook delivery via plugin

Claude Code hooks SHALL be delivered as part of the agent-gauntlet plugin via `hooks/hooks.json` in the plugin directory, instead of being written to `.claude/settings.local.json` during init.

#### Scenario: Claude hooks delivered through plugin
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Claude is among the selected development CLIs
- **WHEN** the plugin is installed
- **THEN** hooks SHALL be served from the plugin's `hooks/hooks.json`
- **AND** init SHALL NOT write hook entries to `.claude/settings.local.json`

#### Scenario: Plugin hooks.json contains start and stop hooks
- **WHEN** the agent-gauntlet plugin is installed
- **THEN** the plugin's `hooks/hooks.json` SHALL contain a stop hook for `agent-gauntlet stop-hook`
- **AND** SHALL contain a start hook for `agent-gauntlet start-hook`
- **AND** the stop hook timeout SHALL be 300 seconds

## Done When

- `.claude-plugin/plugin.json` and `hooks/hooks.json` exist with correct content
- `package.json` `files` array includes `.claude-plugin` and `hooks`
- `agent-gauntlet init` prompts for scope and installs the Claude plugin instead of copying skills
- `agent-gauntlet init` installs Codex skills to the correct directory based on scope
- `agent-gauntlet init` does NOT write hook entries to `settings.local.json`
- `agent-gauntlet init --yes` defaults to local scope
- Plugin install failure warns and continues (does not abort init)
- Tests covering the above scenarios pass
