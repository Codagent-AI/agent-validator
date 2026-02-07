## MODIFIED Requirements

### Requirement: Reviews support YAML configuration files
The system MUST load review configurations from both `.md` and `.yml`/`.yaml` files in the `.gauntlet/reviews/` directory. The review name MUST be derived from the filename (without extension). If both a `.md` and `.yml`/`.yaml` file exist with the same base name, the system MUST reject the configuration with an error.

YAML review files MUST specify exactly one of `prompt_file`, `skill_name`, or `builtin`. These three attributes are mutually exclusive. When `builtin` is specified, the prompt content MUST be loaded from the package's built-in review registry.

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

## ADDED Requirements

### Requirement: Built-in review prompts are pure markdown
Built-in review prompts bundled with the package MUST be pure markdown files with no YAML frontmatter. They contain only the prompt text. All configuration settings (num_reviews, cli_preference, etc.) MUST be specified in the YAML review config file that references the built-in.

#### Scenario: Built-in code-quality prompt content
- **GIVEN** a YAML review config with `builtin: code-quality`
- **WHEN** the configuration is loaded
- **THEN** the `promptContent` contains the code-quality review prompt
- **AND** the prompt covers Bugs, Security, Performance, and Maintainability focus areas
- **AND** the prompt does NOT contain project-specific documentation references

## REMOVED Requirements

### Requirement: Built-in reviews can be referenced via built-in prefix
**Reason**: The `built-in:<name>` prefix syntax for referencing built-in reviews directly in `config.yml` entry points is replaced by the `builtin` attribute in YAML review config files.
**Migration**: Replace `built-in:code-quality` in entry point reviews with a YAML review file (`.gauntlet/reviews/code-quality.yml`) containing `builtin: code-quality`, and reference `code-quality` in entry points.

### Requirement: Built-in code-quality review ships with package
**Reason**: This requirement specified that the built-in prompt includes frontmatter with default settings. Replaced by "Built-in review prompts are pure markdown" (ADDED above), which specifies prompts have no frontmatter.
**Migration**: Settings previously in frontmatter are now specified in the YAML review config file.
