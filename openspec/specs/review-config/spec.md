# review-config Specification

## Purpose
TBD - created by archiving change add-prompt-configurability. Update Purpose after archive.
## Requirements
### Requirement: Reviews support YAML configuration files
The system MUST load review configurations from both `.md` and `.yml`/`.yaml` files in the `.validator/reviews/` directory. The review name MUST be derived from the filename (without extension). If both a `.md` and `.yml`/`.yaml` file exist with the same base name, the system MUST reject the configuration with an error. Reviews MAY also be defined inline in `config.yml` under the top-level `reviews` map (see inline-review-config capability). File-based reviews and inline reviews are merged; a name present in both sources MUST cause a validation error.

YAML review files MUST specify exactly one of `prompt_file`, `skill_name`, or `builtin`. These three attributes are mutually exclusive. When `builtin` is specified, the prompt content MUST be loaded from the package's built-in review registry.

All review file formats (`.md` frontmatter and `.yml`/`.yaml`) MUST support an `enabled` boolean attribute that defaults to `true`. When `enabled` is `false`, the review is opt-in and SHALL only run when explicitly activated via the `--enable-review` CLI option.

#### Scenario: YAML review with prompt_file
- **GIVEN** a file `.validator/reviews/security.yml` with content:
  ```yaml
  prompt_file: prompts/security-review.md
  cli_preference:
    - claude
  ```
- **AND** a file `.validator/prompts/security-review.md` exists with prompt content
- **WHEN** the configuration is loaded
- **THEN** the review "security" is available with `promptContent` loaded from the external file

#### Scenario: YAML review with skill_name
- **GIVEN** a file `.validator/reviews/code-quality.yml` with content:
  ```yaml
  skill_name: code-review
  num_reviews: 2
  ```
- **WHEN** the configuration is loaded
- **THEN** the review "code-quality" is available with `skillName` set to "code-review" and no `promptContent`

#### Scenario: YAML review with builtin attribute
- **GIVEN** a file `.validator/reviews/code-quality.yml` with content:
  ```yaml
  builtin: code-quality
  num_reviews: 2
  ```
- **WHEN** the configuration is loaded
- **THEN** the review "code-quality" is available with `promptContent` loaded from the built-in code-quality prompt
- **AND** `num_reviews` is 2

#### Scenario: YAML review with builtin and no other settings uses schema defaults
- **GIVEN** a file `.validator/reviews/code-quality.yml` with content:
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
- **GIVEN** a file `.validator/reviews/invalid.yml` with both `prompt_file` and `skill_name`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: YAML review with neither prompt source nor builtin
- **GIVEN** a file `.validator/reviews/empty.yml` with none of `prompt_file`, `skill_name`, or `builtin`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: YAML review with builtin and prompt_file is rejected
- **GIVEN** a file `.validator/reviews/invalid.yml` with both `builtin: code-quality` and `prompt_file: prompts/review.md`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error stating the attributes are mutually exclusive

#### Scenario: YAML review with builtin and skill_name is rejected
- **GIVEN** a file `.validator/reviews/invalid.yml` with both `builtin: code-quality` and `skill_name: my-skill`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error stating the attributes are mutually exclusive

#### Scenario: YAML review with unknown builtin name
- **GIVEN** a file `.validator/reviews/bad.yml` with content:
  ```yaml
  builtin: nonexistent
  ```
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with an error indicating the built-in review "nonexistent" is unknown

#### Scenario: Duplicate review name across formats
- **GIVEN** both `.validator/reviews/security.md` and `.validator/reviews/security.yml` exist
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a duplicate name error

#### Scenario: YAML review with enabled false
- **GIVEN** a file `.validator/reviews/task-compliance.yml` with content:
  ```yaml
  builtin: code-quality
  enabled: false
  ```
- **WHEN** the configuration is loaded
- **THEN** the review "task-compliance" is available with `enabled` set to `false`

#### Scenario: Markdown review with enabled false in frontmatter
- **GIVEN** a file `.validator/reviews/task-compliance.md` with frontmatter containing `enabled: false`
- **WHEN** the configuration is loaded
- **THEN** the review "task-compliance" is available with `enabled` set to `false`

#### Scenario: Name collision between inline and file-based review
- **WHEN** `config.yml` defines an inline review named `code-quality`
- **AND** `.validator/reviews/code-quality.yml` also exists
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error naming the conflicting review

### Requirement: Markdown reviews support prompt_file and skill_name in frontmatter
Existing `.md` review files MUST support optional `prompt_file` or `skill_name` fields in their YAML frontmatter. These fields are mutually exclusive. When `prompt_file` is specified, the file content MUST override the markdown body. When `skill_name` is specified, the markdown body MUST be ignored and the skill MUST be used instead.

#### Scenario: Markdown review with prompt_file in frontmatter
- **GIVEN** a file `.validator/reviews/security.md` with frontmatter containing `prompt_file: prompts/shared.md`
- **AND** the file `.validator/prompts/shared.md` exists
- **WHEN** the configuration is loaded
- **THEN** `promptContent` is loaded from `prompts/shared.md`, not from the markdown body

#### Scenario: Markdown review with skill_name in frontmatter
- **GIVEN** a file `.validator/reviews/security.md` with frontmatter containing `skill_name: my-skill`
- **WHEN** the configuration is loaded
- **THEN** `skillName` is set to "my-skill" and `promptContent` is undefined

#### Scenario: Markdown review with both prompt_file and skill_name
- **GIVEN** a file `.validator/reviews/invalid.md` with frontmatter containing both `prompt_file` and `skill_name`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

### Requirement: Prompt file paths support absolute and relative resolution
The `prompt_file` field MUST accept both absolute and relative file paths. Relative paths MUST resolve from the `.validator/` directory. When an absolute path is used, the system MUST log a warning. The system MUST reject the configuration if the referenced file does not exist.

#### Scenario: Relative path resolves from .validator directory
- **GIVEN** a review config with `prompt_file: prompts/review.md`
- **AND** the file `.validator/prompts/review.md` exists
- **WHEN** the configuration is loaded
- **THEN** the content is loaded from `.validator/prompts/review.md`

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
The system MUST support optional per-adapter configuration under the `cli.adapters` section of `.validator/config.yml`. Each adapter entry is keyed by adapter name and the system MUST accept optional `allow_tool_use` (boolean, defaults to `true`), `thinking_budget` (one of `off`, `low`, `medium`, `high`), and `model` (string) when provided. When `thinking_budget` is not specified, the adapter MUST use its built-in default behavior (no thinking budget override is applied). When `model` is not specified, the adapter MUST NOT pass a `--model` flag to the CLI (preserving current default behavior). Unknown adapter names in the config are silently ignored at the schema level. When specified, these settings MUST be passed to the adapter's `execute()` method and applied to the CLI invocation.

#### Scenario: Adapter with tool use disabled
- **GIVEN** a `.validator/config.yml` with `cli.adapters.gemini.allow_tool_use: false`
- **WHEN** a review is executed using the Gemini adapter
- **THEN** the Gemini CLI MUST be invoked without the `--allowed-tools` argument

#### Scenario: Adapter with tool use enabled (default)
- **GIVEN** a `.validator/config.yml` with no `allow_tool_use` setting for Claude
- **WHEN** a review is executed using the Claude adapter
- **THEN** the Claude CLI MUST be invoked with the `--allowedTools` argument containing the default tool set

#### Scenario: Adapter with thinking budget configured
- **GIVEN** a `.validator/config.yml` with `cli.adapters.codex.thinking_budget: high`
- **WHEN** a review is executed using the Codex adapter
- **THEN** the Codex CLI MUST be invoked with `-c model_reasoning_effort="high"`

#### Scenario: Invalid thinking budget level rejected
- **GIVEN** a `.validator/config.yml` with `cli.adapters.claude.thinking_budget: extreme`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: Adapter with partial configuration
- **GIVEN** a `.validator/config.yml` with `cli.adapters.gemini.allow_tool_use: false` and no `thinking_budget` setting
- **WHEN** a review is executed using the Gemini adapter
- **THEN** tools MUST be disabled AND the thinking budget MUST use the adapter's built-in default

#### Scenario: No adapter config section
- **GIVEN** a `.validator/config.yml` with no `cli.adapters` section
- **WHEN** reviews are executed
- **THEN** all adapters MUST use their default hardcoded settings (tool use enabled, no thinking budget override, no model override)

#### Scenario: Adapter with model configured
- **GIVEN** a `.validator/config.yml` with `cli.adapters.cursor.model: codex`
- **WHEN** a review is executed using the Cursor adapter
- **THEN** the Cursor adapter MUST resolve the model name and pass `--model <resolved-id>` to the CLI

#### Scenario: Adapter with model absent
- **GIVEN** a `.validator/config.yml` with no `model` setting for the Cursor adapter
- **WHEN** a review is executed using the Cursor adapter
- **THEN** the Cursor CLI MUST be invoked without a `--model` flag

### Requirement: Adapter Model Resolution
When an adapter has a `model` configured, the adapter MUST resolve the base model name to a specific model ID at runtime by querying the CLI for available models, filtering to matches, and selecting the highest-versioned result. The resolution logic MUST:

1. Query the CLI for available models (Cursor: `agent --list-models`; GitHub Copilot: parse `copilot --help` output for `--model` choices).
2. Filter to models whose ID contains the configured base name as a complete hyphen-delimited segment (e.g. `codex` matches `gpt-5.3-codex` and `gpt-5.3-codex-low` because `codex` is a complete segment, but does NOT match `gpt-5.3-codecx` because `codecx` is a different segment). The base name MUST appear as a whole token between hyphens (or at the start/end of the ID), not as an arbitrary substring.
3. Exclude quality-tier variants (model IDs ending in `-low`, `-high`, `-xhigh`, or `-fast`).
4. If `thinking_budget` is set and not `off`, prefer models with a `-thinking` suffix when available (Cursor only; GitHub Copilot has no thinking variants). When thinking is preferred but no `-thinking` variant exists for the matched models, the adapter MUST fall back to the non-thinking variant.
5. Sort remaining candidates by version descending and select the highest. The version SHALL be extracted as the first occurrence of a `MAJOR.MINOR` pattern (regex `(\d+)\.(\d+)`) in the model ID. If no `MAJOR.MINOR` pattern is found, the model is sorted after all versioned models. Versions SHALL be compared numerically (major first, then minor). When two candidates have the same version, the first one encountered in the input list is selected.
6. On failure (CLI query fails, no matches found), log a warning and proceed without a `--model` flag.

#### Scenario: Cursor resolves highest-versioned codex model
- **GIVEN** `cli.adapters.cursor.model: codex` and `cli.adapters.cursor.thinking_budget: low`
- **AND** `agent --list-models` returns models including `gpt-5.3-codex`, `gpt-5.3-codex-low`, `gpt-5.3-codex-high`, `gpt-5.2-codex`
- **WHEN** the Cursor adapter resolves the model
- **THEN** tier variants (`gpt-5.3-codex-low`, `gpt-5.3-codex-high`) MUST be excluded
- **AND** `gpt-5.3-codex` MUST be selected as the highest version
- **AND** the CLI MUST be invoked with `--model gpt-5.3-codex`

#### Scenario: Cursor resolves thinking variant when thinking_budget is active
- **GIVEN** `cli.adapters.cursor.model: opus` and `cli.adapters.cursor.thinking_budget: high`
- **AND** `agent --list-models` returns `opus-4.6`, `opus-4.6-thinking`, `opus-4.5`, `opus-4.5-thinking`
- **WHEN** the Cursor adapter resolves the model
- **THEN** thinking variants MUST be preferred because `thinking_budget` is not `off`
- **AND** `opus-4.6-thinking` MUST be selected as the highest-versioned thinking variant
- **AND** the CLI MUST be invoked with `--model opus-4.6-thinking`

#### Scenario: Cursor falls back to non-thinking when thinking variant unavailable
- **GIVEN** `cli.adapters.cursor.model: codex` and `cli.adapters.cursor.thinking_budget: high`
- **AND** `agent --list-models` returns `gpt-5.3-codex` (no `-thinking` variant available)
- **WHEN** the Cursor adapter resolves the model
- **THEN** `gpt-5.3-codex` MUST be selected as the best available match
- **AND** the CLI MUST be invoked with `--model gpt-5.3-codex`

#### Scenario: Thinking variants excluded when thinking_budget is off
- **GIVEN** `cli.adapters.cursor.model: opus` and `cli.adapters.cursor.thinking_budget: off`
- **AND** `agent --list-models` returns `opus-4.6`, `opus-4.6-thinking`
- **WHEN** the Cursor adapter resolves the model
- **THEN** `opus-4.6` MUST be selected (non-thinking variant)
- **AND** `opus-4.6-thinking` MUST NOT be selected

#### Scenario: GitHub Copilot resolves model without thinking variants
- **GIVEN** `cli.adapters.github-copilot.model: codex`
- **AND** `copilot --help` lists `--model` choices including `gpt-5.3-codex` and `gpt-5.2-codex`
- **WHEN** the GitHub Copilot adapter resolves the model
- **THEN** `gpt-5.3-codex` MUST be selected as the highest version
- **AND** the CLI MUST be invoked with `--model gpt-5.3-codex`

#### Scenario: Base name matching uses segment boundaries
- **GIVEN** `cli.adapters.cursor.model: codex`
- **AND** `agent --list-models` returns `gpt-5.3-codex`, `gpt-5.3-codex-low`, `gpt-5.3-codecx`
- **WHEN** the Cursor adapter filters by base name
- **THEN** `gpt-5.3-codex` MUST match (`codex` is a complete hyphen-delimited segment)
- **AND** `gpt-5.3-codex-low` MUST match (`codex` is a complete segment; tier exclusion handles it separately in step 3)
- **AND** `gpt-5.3-codecx` MUST NOT match (`codecx` is not the same segment as `codex`)

#### Scenario: Model resolution failure falls back gracefully
- **GIVEN** `cli.adapters.cursor.model: nonexistent`
- **AND** `agent --list-models` returns no models matching `nonexistent`
- **WHEN** the Cursor adapter resolves the model
- **THEN** a warning MUST be logged indicating no matching model was found
- **AND** the CLI MUST be invoked without a `--model` flag

#### Scenario: CLI query failure falls back gracefully
- **GIVEN** `cli.adapters.cursor.model: codex`
- **AND** `agent --list-models` fails (non-zero exit code or timeout)
- **WHEN** the Cursor adapter attempts to resolve the model
- **THEN** a warning MUST be logged indicating the model query failed
- **AND** the CLI MUST be invoked without a `--model` flag

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
Built-in review prompts bundled with the package MUST be pure markdown files with no YAML frontmatter. They contain only the prompt text. All configuration settings (num_reviews, cli_preference, etc.) MUST be specified in the YAML review config file that references the built-in. The package SHALL ship four built-in reviews: `code-quality`, `security`, `error-handling`, and `task-compliance`. All built-in reviewers SHALL prioritize recall over precision — when uncertain, the reviewer reports the issue rather than suppressing it.

#### Scenario: Built-in code-quality prompt is self-contained
- **GIVEN** a YAML review config with `builtin: code-quality`
- **WHEN** the configuration is loaded
- **THEN** the `promptContent` SHALL contain a self-contained code review prompt with no references to external agents or toolkits
- **AND** the `promptContent` SHALL NOT contain project-specific documentation references

#### Scenario: Built-in security prompt loaded by name
- **GIVEN** a YAML review config with `builtin: security`
- **WHEN** the configuration is loaded
- **THEN** the `promptContent` SHALL be loaded from the built-in security review prompt
- **AND** the prompt SHALL focus on security-specific concerns (injection, auth/authz, secrets exposure, input validation)

#### Scenario: Built-in error-handling prompt loaded by name
- **GIVEN** a YAML review config with `builtin: error-handling`
- **WHEN** the configuration is loaded
- **THEN** the `promptContent` SHALL be loaded from the built-in error-handling review prompt
- **AND** the prompt SHALL focus on error-handling concerns (swallowed errors, missing observability, silent failures)

#### Scenario: Built-in task-compliance prompt loaded by name
- **GIVEN** a YAML review config with `builtin: task-compliance`
- **WHEN** the configuration is loaded
- **THEN** the `promptContent` SHALL be loaded from the built-in task-compliance review prompt
- **AND** the prompt SHALL contain the `{{CONTEXT}}` placeholder for runtime context injection
- **AND** the prompt SHALL focus on verifying that every requirement, acceptance criterion, and done-when item from the injected task specification is fully implemented in the diff

#### Scenario: Unknown built-in name rejected
- **GIVEN** a YAML review config with `builtin: nonexistent`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with an error indicating the built-in review "nonexistent" is unknown

### Requirement: Runtime context injection via --context-file
The `run` and `review` commands MUST accept a `--context-file <path>` CLI option that reads a file and injects its contents into review prompts at execution time. The file contents replace the `{{CONTEXT}}` placeholder in `promptContent` during prompt building. This mechanism is general-purpose — any review (built-in or user-authored) MAY use the `{{CONTEXT}}` placeholder.

When `--context-file` is provided, the file MUST be read before review execution begins. When `--context-file` is not provided, any `{{CONTEXT}}` placeholder in the prompt MUST be replaced with an empty string. The `--context-file` path MUST be resolved relative to the current working directory. If the file does not exist, the system MUST exit with an error.

#### Scenario: Context file contents injected into prompt
- **GIVEN** a review prompt containing `{{CONTEXT}}`
- **AND** `--context-file path/to/task.md` is passed on the CLI
- **AND** `path/to/task.md` contains task specification text
- **WHEN** the review prompt is built
- **THEN** `{{CONTEXT}}` in the prompt SHALL be replaced with the full contents of `path/to/task.md`

#### Scenario: Context file used with task-compliance built-in
- **GIVEN** a review configured with `builtin: task-compliance`
- **AND** `--enable-review task-compliance` is passed
- **AND** `--context-file tasks/implement-feature.md` is passed
- **WHEN** the review executes
- **THEN** the task-compliance prompt SHALL contain the full contents of `tasks/implement-feature.md` in place of `{{CONTEXT}}`
- **AND** the reviewer SHALL evaluate the diff against the task specification

#### Scenario: No context file provided with CONTEXT placeholder
- **GIVEN** a review prompt containing `{{CONTEXT}}`
- **AND** no `--context-file` option is passed
- **WHEN** the review prompt is built
- **THEN** `{{CONTEXT}}` SHALL be replaced with an empty string

#### Scenario: Context file does not exist
- **GIVEN** `--context-file nonexistent.md` is passed on the CLI
- **WHEN** the system attempts to read the file
- **THEN** the system MUST exit with an error indicating the file was not found

#### Scenario: Context file with review that has no placeholder
- **GIVEN** a review prompt that does NOT contain `{{CONTEXT}}`
- **AND** `--context-file path/to/task.md` is passed on the CLI
- **WHEN** the review prompt is built
- **THEN** the prompt SHALL remain unchanged (the context is unused)
- **AND** no error or warning SHALL be emitted

