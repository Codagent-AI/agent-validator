# Task: Update GitHub Copilot adapter for gh copilot invocation and plugin support

## Goal

Rewrite the `github-copilot` adapter to invoke via `gh copilot --` instead of the standalone `copilot` binary, add skill directory support, implement the plugin lifecycle (detect/install/update), map thinking budget to `--effort`, and update the init flow to treat Copilot CLI as a native skill-capable CLI.

## Background

The GitHub Copilot CLI is now GA (v1.0.11) as a full coding agent accessible via `gh copilot`. The current adapter in `src/cli-adapters/github-copilot.ts` references the standalone `copilot` binary, returns `null` for all skill directories, and has no plugin support. POC testing has confirmed the exact command patterns that work.

**Invocation pattern — all commands use `gh copilot --` prefix:**
- Execution: `cat tmpFile | gh copilot -- -s --allow-tool 'shell(cat)' --allow-tool 'shell(grep)' ...`
- Plugin install: `gh copilot -- plugin install Codagent-AI/agent-validator`
- Health check: `gh copilot -- --help`

**Stdin piping works WITHOUT the `-p` flag.** The `-p` flag is for inline prompts only. Pipe prompt+diff content via stdin. The `-s` (silent) flag suppresses UI/stats and returns only the agent response — essential for clean output parsing.

**Model pass-through (no resolution).** The old adapter parsed `copilot --help` for model choices. The new CLI accepts free-form `--model <name>` — no discovery mechanism exists. Remove the `resolveModel()` private method and `parseCopilotModels()` helper entirely. Pass the configured model name directly to `--model`. Invalid models produce: `Error: Model "..." is not available`.

**Thinking budget maps to `--effort` flag.** Copilot uses `--effort` (`low`, `medium`, `high`, `xhigh`):
- `thinkingBudget: 'off'` → no `--effort` flag
- `thinkingBudget: 'low'` → `--effort low`
- `thinkingBudget: 'medium'` → `--effort medium`
- `thinkingBudget: 'high'` → `--effort high`

**Tool restriction uses `--allow-tool`.** Same syntax as the old adapter. For `allowToolUse: true`: pass `--allow-tool 'shell(cat)'` etc. for the six read-only tools (cat, grep, ls, find, head, tail). For `allowToolUse: false`: no `--allow-tool` flags.

**Plugin lifecycle — create `src/plugin/copilot-cli.ts` mirroring `src/plugin/claude-cli.ts`:**
- `installPlugin()` — runs `execFileSync('gh', ['copilot', '--', 'plugin', 'install', 'Codagent-AI/agent-validator'])` with a 60s timeout
- `detectPlugin()` — reads `~/.copilot/config.json`, parses the `installed_plugins` JSON array, checks for entries with `name === 'agent-validator'` or `name === 'agent-gauntlet'`. Returns `true` if found. The confirmed `config.json` structure is:
  ```json
  {
    "installed_plugins": [
      {
        "name": "agent-validator",
        "version": "1.4.0",
        "cache_path": "~/.copilot/installed-plugins/_direct/Codagent-AI--agent-validator",
        "source": { "source": "github", "repo": "Codagent-AI/agent-validator" }
      }
    ]
  }
  ```
- Plugin detection returns `'user'` only (no project scope in Copilot). The `scope` parameter in `installPlugin()` is accepted for interface compatibility but ignored.

**Skill directories:**
- `getProjectSkillDir()` → `.github/skills`
- `getUserSkillDir()` → `path.join(os.homedir(), '.copilot', 'skills')`

**Hooks:** `supportsHooks()` → `true`

**Init flow updates in `src/commands/init.ts`:**
- Add `'github-copilot'` to the `NATIVE_CLIS` set (line ~78) so post-init instructions show `/validator-setup`
- No other init changes needed — the existing `detectAdaptersNeedingInstall` → `installAdapterPlugin` pipeline already handles any adapter that implements `installPlugin()`

**Key files to modify/create:**
- `src/cli-adapters/github-copilot.ts` — major rewrite (invocation, flags, skill dirs, plugin methods)
- `src/plugin/copilot-cli.ts` — new file, mirrors `src/plugin/claude-cli.ts`
- `src/commands/init.ts` — add `'github-copilot'` to `NATIVE_CLIS`
- `test/cli-adapters/copilot-model-resolution.test.ts` — delete or rewrite (model resolution is removed)

**Key files to read for patterns:**
- `src/plugin/claude-cli.ts` — pattern for `copilot-cli.ts`
- `src/cli-adapters/claude.ts` — pattern for plugin lifecycle methods in adapter
- `src/cli-adapters/cursor.ts` — pattern for skill dir reporting and `detectPlugin`/`installPlugin`
- `src/cli-adapters/shared.ts` — `CLIAdapter` interface and `runStreamingCommand` helper

## Spec

### Requirement: Adapter invokes via gh copilot

The `github-copilot` adapter SHALL invoke the Copilot CLI through `gh copilot` rather than the standalone `copilot` binary. This ensures the CLI is auto-managed by `gh`.

#### Scenario: Successful execution via gh copilot
- **WHEN** the adapter executes a prompt with a diff
- **THEN** it SHALL invoke `gh copilot` (not standalone `copilot`) with the prompt content piped via stdin

#### Scenario: Availability check verifies gh copilot
- **WHEN** `isAvailable()` is called
- **THEN** it SHALL run `gh copilot -- --help` and return `true` only if the command succeeds

#### Scenario: Health check reports missing when gh copilot unavailable
- **WHEN** `gh` is not installed or `gh copilot -- --help` fails
- **THEN** `checkHealth()` SHALL return `{ available: false, status: 'missing' }`

### Requirement: Adapter declares skill directories

The adapter SHALL report Copilot CLI's native skill directories so the init system can install skills to the correct locations.

#### Scenario: Project skill directory
- **WHEN** `getProjectSkillDir()` is called
- **THEN** it SHALL return `.github/skills`

#### Scenario: User skill directory
- **WHEN** `getUserSkillDir()` is called
- **THEN** it SHALL return the absolute path `~/.copilot/skills` (expanded)

### Requirement: Adapter supports hooks

The adapter SHALL declare hook support since the Copilot CLI plugin system supports hooks.

#### Scenario: Hook support declared
- **WHEN** `supportsHooks()` is called
- **THEN** it SHALL return `true`

### Requirement: Adapter execution flags align with current CLI

The adapter SHALL use the current `gh copilot` flag surface for execution, tool restrictions, and model selection.

#### Scenario: Prompt and diff passed via stdin
- **WHEN** executing with a prompt and diff
- **THEN** the adapter SHALL write the combined content to a temp file, pipe it via stdin to `gh copilot`, and use `--allow-tool` flags for read-only shell tools (cat, grep, ls, find, head, tail)

#### Scenario: Tool use disabled
- **WHEN** `allowToolUse` is `false`
- **THEN** no `--allow-tool` flags SHALL be passed to the command

#### Scenario: Model pass-through
- **WHEN** a model name is specified in the adapter config
- **THEN** the adapter SHALL pass it directly to the `--model` flag without resolution
- **AND** invalid model names SHALL result in the Copilot CLI returning an error

#### Scenario: Reasoning effort mapping
- **WHEN** a `thinkingBudget` is configured
- **AND** the value is not `'off'`
- **THEN** the adapter SHALL pass `--effort <level>` mapping `low`→`low`, `medium`→`medium`, `high`→`high`

#### Scenario: Silent output mode
- **WHEN** executing a prompt for review
- **THEN** the adapter SHALL pass the `-s` (silent) flag to suppress UI output and return only the agent response

### Requirement: Adapter implements plugin lifecycle

The adapter SHALL implement `detectPlugin`, `installPlugin`, `updatePlugin`, and `getManualInstallInstructions` following the Copilot CLI plugin system.

#### Scenario: Plugin detection reads config.json
- **WHEN** `detectPlugin()` is called
- **THEN** it SHALL read `~/.copilot/config.json` and check the `installed_plugins` array for entries with `name` matching `agent-validator` or `agent-gauntlet`
- **AND** return `'user'` if found, `null` otherwise

#### Scenario: Plugin installation via gh copilot
- **WHEN** `installPlugin()` is called
- **THEN** it SHALL run `gh copilot -- plugin install Codagent-AI/agent-validator`
- **AND** the scope parameter SHALL be accepted for interface compatibility but ignored (Copilot always installs to user scope)

#### Scenario: Plugin update re-runs installation
- **WHEN** `updatePlugin()` is called
- **THEN** it SHALL delegate to `installPlugin()` (re-install overwrites)

#### Scenario: Manual install instructions
- **WHEN** `getManualInstallInstructions()` is called
- **THEN** it SHALL return instructions including `gh copilot -- plugin install Codagent-AI/agent-validator`

### Requirement: Init installs Copilot plugin via CLI command

When `github-copilot` is selected as a development CLI during init, the init flow SHALL install the agent-validator plugin using the Copilot CLI's native plugin install mechanism.

#### Scenario: Copilot selected triggers plugin installation
- **WHEN** the user selects `github-copilot` as a development CLI during init
- **AND** the plugin is not already installed
- **THEN** init SHALL delegate to the adapter's `installPlugin()` method

#### Scenario: Plugin already installed skips install
- **WHEN** the user selects `github-copilot` as a development CLI during init
- **AND** the adapter's `detectPlugin()` returns a scope
- **THEN** init SHALL inform the user the plugin is already installed and at which scope
- **AND** SHALL skip the install step

### Requirement: Init outputs next-step message

After completing setup, `init` SHALL print context-aware instructions based on the selected development CLIs. Native CLI users (Claude Code, Cursor, GitHub Copilot) SHALL receive `/validator-setup` slash-command instructions.

#### Scenario: GitHub Copilot user instructions
- **GIVEN** the user selected `github-copilot` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/validator-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Validator will run."

#### Scenario: GitHub Copilot is NOT in the file-copy bucket
- **GIVEN** the user selects `github-copilot` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** skills SHALL NOT be copied to `.claude/skills/` or `.github/skills/` via file copy
- **AND** the plugin install mechanism SHALL be used instead

## Done When

All spec scenarios above are covered by tests and passing. The adapter executes prompts via `gh copilot -- -s`, the plugin lifecycle works end-to-end, and `github-copilot` appears in NATIVE_CLIS for post-init `/validator-setup` instructions.
