# review-config Specification

## Purpose
TBD - created by archiving change add-prompt-configurability. Update Purpose after archive.
## Requirements
### Requirement: Reviews support YAML configuration files
The system MUST load review configurations from both `.md` and `.yml`/`.yaml` files in the `.gauntlet/reviews/` directory. The review name MUST be derived from the filename (without extension). If both a `.md` and `.yml`/`.yaml` file exist with the same base name, the system MUST reject the configuration with an error.

YAML review files MUST specify exactly one of `prompt_file`, `skill_name`, or `builtin`. These three attributes are mutually exclusive. When `builtin` is specified, the prompt content MUST be loaded from the package's built-in review registry.

All review file formats (`.md` frontmatter and `.yml`/`.yaml`) MUST support an `enabled` boolean attribute that defaults to `true`. When `enabled` is `false`, the review is opt-in and SHALL only run when explicitly activated via the `--enable-review` CLI option.

#### Scenario: YAML review with prompt_file
- **GIVEN** a file `.gauntlet/reviews/security.yml` with content:
  ```yaml
  prompt_file: prompts/security-review.md
  cli_preference:
    - claude
  ```
- **AND** a file `.gauntlet/prompts/security-review.md` exists with prompt content
- **WHEN** the configuration is loaded
- **THEN** the review "security" is available with `promptContent` loaded from the external file

#### Scenario: YAML review with skill_name
- **GIVEN** a file `.gauntlet/reviews/code-quality.yml` with content:
  ```yaml
  skill_name: code-review
  num_reviews: 2
  ```
- **WHEN** the configuration is loaded
- **THEN** the review "code-quality" is available with `skillName` set to "code-review" and no `promptContent`

#### Scenario: YAML review with builtin attribute
- **GIVEN** a file `.gauntlet/reviews/code-quality.yml` with content:
  ```yaml
  builtin: code-quality
  num_reviews: 2
  ```
- **WHEN** the configuration is loaded
- **THEN** the review "code-quality" is available with `promptContent` loaded from the built-in code-quality prompt
- **AND** `num_reviews` is 2

#### Scenario: YAML review with builtin and no other settings uses schema defaults
- **GIVEN** a file `.gauntlet/reviews/code-quality.yml` with content:
  ```yaml
  builtin: code-quality
  ```
- **WHEN** the configuration is loaded
- **THEN** the review "code-quality" is available with `promptContent` loaded from the built-in code-quality prompt
- **AND** `num_reviews` defaults to 1
- **AND** `parallel` defaults to true
- **AND** `run_in_ci` defaults to true
- **AND** `run_locally` defaults to true
- **AND** `enabled` defaults to true

#### Scenario: YAML review must specify exactly one prompt source
- **GIVEN** a file `.gauntlet/reviews/invalid.yml` with both `prompt_file` and `skill_name`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: YAML review with neither prompt source nor builtin
- **GIVEN** a file `.gauntlet/reviews/empty.yml` with none of `prompt_file`, `skill_name`, or `builtin`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: YAML review with builtin and prompt_file is rejected
- **GIVEN** a file `.gauntlet/reviews/invalid.yml` with both `builtin: code-quality` and `prompt_file: prompts/review.md`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error stating the attributes are mutually exclusive

#### Scenario: YAML review with builtin and skill_name is rejected
- **GIVEN** a file `.gauntlet/reviews/invalid.yml` with both `builtin: code-quality` and `skill_name: my-skill`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error stating the attributes are mutually exclusive

#### Scenario: YAML review with unknown builtin name
- **GIVEN** a file `.gauntlet/reviews/bad.yml` with content:
  ```yaml
  builtin: nonexistent
  ```
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with an error indicating the built-in review "nonexistent" is unknown

#### Scenario: Duplicate review name across formats
- **GIVEN** both `.gauntlet/reviews/security.md` and `.gauntlet/reviews/security.yml` exist
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a duplicate name error

#### Scenario: YAML review with enabled false
- **GIVEN** a file `.gauntlet/reviews/task-compliance.yml` with content:
  ```yaml
  builtin: code-quality
  enabled: false
  ```
- **WHEN** the configuration is loaded
- **THEN** the review "task-compliance" is available with `enabled` set to `false`

#### Scenario: Markdown review with enabled false in frontmatter
- **GIVEN** a file `.gauntlet/reviews/task-compliance.md` with frontmatter containing `enabled: false`
- **WHEN** the configuration is loaded
- **THEN** the review "task-compliance" is available with `enabled` set to `false`

### Requirement: Markdown reviews support prompt_file and skill_name in frontmatter
Existing `.md` review files MUST support optional `prompt_file` or `skill_name` fields in their YAML frontmatter. These fields are mutually exclusive. When `prompt_file` is specified, the file content MUST override the markdown body. When `skill_name` is specified, the markdown body MUST be ignored and the skill MUST be used instead.

#### Scenario: Markdown review with prompt_file in frontmatter
- **GIVEN** a file `.gauntlet/reviews/security.md` with frontmatter containing `prompt_file: prompts/shared.md`
- **AND** the file `.gauntlet/prompts/shared.md` exists
- **WHEN** the configuration is loaded
- **THEN** `promptContent` is loaded from `prompts/shared.md`, not from the markdown body

#### Scenario: Markdown review with skill_name in frontmatter
- **GIVEN** a file `.gauntlet/reviews/security.md` with frontmatter containing `skill_name: my-skill`
- **WHEN** the configuration is loaded
- **THEN** `skillName` is set to "my-skill" and `promptContent` is undefined

#### Scenario: Markdown review with both prompt_file and skill_name
- **GIVEN** a file `.gauntlet/reviews/invalid.md` with frontmatter containing both `prompt_file` and `skill_name`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

### Requirement: Prompt file paths support absolute and relative resolution
The `prompt_file` field MUST accept both absolute and relative file paths. Relative paths MUST resolve from the `.gauntlet/` directory. When an absolute path is used, the system MUST log a warning. The system MUST reject the configuration if the referenced file does not exist.

#### Scenario: Relative path resolves from .gauntlet directory
- **GIVEN** a review config with `prompt_file: prompts/review.md`
- **AND** the file `.gauntlet/prompts/review.md` exists
- **WHEN** the configuration is loaded
- **THEN** the content is loaded from `.gauntlet/prompts/review.md`

#### Scenario: Absolute path with warning
- **GIVEN** a review config with `prompt_file: /shared/prompts/review.md`
- **AND** the file `/shared/prompts/review.md` exists
- **WHEN** the configuration is loaded
- **THEN** the content is loaded from the absolute path
- **AND** a warning is logged about using absolute paths

#### Scenario: Missing prompt file
- **GIVEN** a review config with `prompt_file: nonexistent.md`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a file-not-found error

### Requirement: Per-Adapter Configuration
The system MUST support optional per-adapter configuration under the `cli.adapters` section of `.gauntlet/config.yml`. Each adapter entry is keyed by adapter name and the system MUST accept optional `allow_tool_use` (boolean, defaults to `true`) and `thinking_budget` (one of `off`, `low`, `medium`, `high`) when provided. When `thinking_budget` is not specified, the adapter MUST use its built-in default behavior (no thinking budget override is applied). Unknown adapter names in the config are silently ignored at the schema level. When specified, these settings MUST be passed to the adapter's `execute()` method and applied to the CLI invocation.

#### Scenario: Adapter with tool use disabled
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.gemini.allow_tool_use: false`
- **WHEN** a review is executed using the Gemini adapter
- **THEN** the Gemini CLI MUST be invoked without the `--allowed-tools` argument

#### Scenario: Adapter with tool use enabled (default)
- **GIVEN** a `.gauntlet/config.yml` with no `allow_tool_use` setting for Claude
- **WHEN** a review is executed using the Claude adapter
- **THEN** the Claude CLI MUST be invoked with the `--allowedTools` argument containing the default tool set

#### Scenario: Adapter with thinking budget configured
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.codex.thinking_budget: high`
- **WHEN** a review is executed using the Codex adapter
- **THEN** the Codex CLI MUST be invoked with `-c model_reasoning_effort="high"`

#### Scenario: Invalid thinking budget level rejected
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.claude.thinking_budget: extreme`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: Adapter with partial configuration
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.gemini.allow_tool_use: false` and no `thinking_budget` setting
- **WHEN** a review is executed using the Gemini adapter
- **THEN** tools MUST be disabled AND the thinking budget MUST use the adapter's built-in default

#### Scenario: No adapter config section
- **GIVEN** a `.gauntlet/config.yml` with no `cli.adapters` section
- **WHEN** reviews are executed
- **THEN** all adapters MUST use their default hardcoded settings (tool use enabled, no thinking budget override)

### Requirement: Adapter Thinking Budget Level Mapping
The system MUST map the unified `thinking_budget` level string to adapter-specific values. The mapping MUST be:

- **Claude**: `off`=0, `low`=8000, `medium`=16000, `high`=31999 (set via `MAX_THINKING_TOKENS` environment variable)
- **Codex**: `off`=`"minimal"`, `low`=`"low"`, `medium`=`"medium"`, `high`=`"high"` (set via `-c model_reasoning_effort` CLI flag)
- **Gemini**: `off`=0, `low`=4096, `medium`=8192, `high`=24576 (set via `thinkingConfig.thinkingBudget` in `.gemini/settings.json`)

#### Scenario: Claude thinking budget applied via environment variable
- **GIVEN** a review configured with `thinking_budget: medium` for Claude
- **WHEN** the Claude CLI is invoked
- **THEN** the environment variable `MAX_THINKING_TOKENS` MUST be set to `16000`

#### Scenario: Codex thinking budget applied via CLI flag
- **GIVEN** a review configured with `thinking_budget: high` for Codex
- **WHEN** the Codex CLI is invoked
- **THEN** the CLI args MUST include `-c model_reasoning_effort="high"`

#### Scenario: Gemini thinking budget applied via settings file
- **GIVEN** a review configured with `thinking_budget: low` for Gemini
- **WHEN** the Gemini CLI is invoked
- **THEN** a `.gemini/settings.json` file MUST be written with `thinkingConfig.thinkingBudget` set to `4096`
- **AND** if the `.gemini/` directory does not exist, it MUST be created
- **AND** the original settings file (if any) MUST be restored after execution completes
- **AND** if no `.gemini/settings.json` existed before execution, the file MUST be removed after execution completes

#### Scenario: Gemini settings file cleanup on error
- **GIVEN** a review configured with `thinking_budget: low` for Gemini
- **WHEN** the Gemini CLI invocation fails or times out
- **THEN** the original `.gemini/settings.json` MUST still be restored

### Requirement: Built-in review prompts are pure markdown
Built-in review prompts bundled with the package MUST be pure markdown files with no YAML frontmatter. They contain only the prompt text. All configuration settings (num_reviews, cli_preference, etc.) MUST be specified in the YAML review config file that references the built-in.

#### Scenario: Built-in code-quality prompt content
- **GIVEN** a YAML review config with `builtin: code-quality`
- **WHEN** the configuration is loaded
- **THEN** the `promptContent` SHALL contain instructions to use pr-review-toolkit agents (code-reviewer, silent-failure-hunter, type-design-analyzer) when the reviewing CLI has access to them
- **AND** the `promptContent` SHALL contain a fallback inline review framework covering three lenses (code quality/bugs/security, silent failures/error handling, type design) for use when those agents are unavailable
- **AND** the `promptContent` SHALL NOT contain project-specific documentation references

#### Scenario: Built-in code-quality prompt with partial pr-review-toolkit availability
- **GIVEN** a YAML review config with `builtin: code-quality`
- **WHEN** the configuration is loaded
- **THEN** the `promptContent` SHALL instruct the reviewer to use whichever pr-review-toolkit agents are available and fall back to inline analysis for lenses whose agents are missing

