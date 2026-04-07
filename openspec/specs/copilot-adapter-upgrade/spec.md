# copilot-adapter-upgrade Specification

## Purpose
Update the GitHub Copilot adapter to use the standalone `copilot` CLI invocation (replacing the deprecated `gh copilot` extension), declare skill directories, support hooks, and implement the plugin lifecycle.

## ADDED Requirements

### Requirement: Adapter invokes via standalone copilot CLI

The `github-copilot` adapter SHALL invoke the Copilot CLI through the standalone `copilot` binary rather than the deprecated `gh copilot` extension. The `gh copilot` extension was deprecated on 2025-10-25 in favor of the standalone CLI.

#### Scenario: Successful execution via copilot
- **WHEN** the adapter executes a prompt with a diff
- **THEN** it SHALL invoke `copilot` (not `gh copilot`) with the prompt content piped via stdin

#### Scenario: Availability check verifies copilot
- **WHEN** `isAvailable()` is called
- **THEN** it SHALL run `copilot --help` and return `true` only if the command succeeds

#### Scenario: Health check reports missing when copilot unavailable
- **WHEN** `copilot` is not installed or `copilot --help` fails
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

The adapter SHALL use the current `copilot` CLI flag surface for execution, tool restrictions, and model selection.

#### Scenario: Prompt and diff passed via stdin
- **WHEN** executing with a prompt and diff
- **THEN** the adapter SHALL write the combined content to a temp file, pipe it via stdin to `copilot`, and use `--allow-tool` flags for read-only shell tools (cat, grep, ls, find, head, tail)

#### Scenario: Tool use disabled
- **WHEN** `allowToolUse` is `false`
- **THEN** no `--allow-tool` flags SHALL be passed to the command

#### Scenario: Model pass-through
- **WHEN** a model name is specified in the adapter config
- **THEN** the adapter SHALL pass it directly to the `--model` flag without resolution
- **AND** invalid model names SHALL result in the Copilot CLI returning an error

.

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
- **THEN** it SHALL read `~/.copilot/config.json` and check the `installed_plugins` array for entries with `name` matching `agent-validator` (or `agent-gauntlet` for backward compatibility)
- **AND** return `'user'` if found, `null` otherwise

#### Scenario: Plugin installation via copilot
- **WHEN** `installPlugin()` is called
- **THEN** it SHALL run `copilot plugin install Codagent-AI/agent-validator`
- **AND** the scope parameter SHALL be accepted for interface compatibility but ignored (Copilot always installs to user scope)

#### Scenario: Plugin update re-runs installation
- **WHEN** `updatePlugin()` is called
- **THEN** it SHALL delegate to `installPlugin()` (re-install overwrites)

#### Scenario: Manual install instructions
- **WHEN** `getManualInstallInstructions()` is called
- **THEN** it SHALL return instructions including `copilot plugin install Codagent-AI/agent-validator`
