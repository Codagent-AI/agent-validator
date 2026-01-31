# review-config Specification

## Purpose
TBD - created by archiving change add-prompt-configurability. Update Purpose after archive.
## Requirements
### Requirement: Reviews support YAML configuration files
The system MUST load review configurations from both `.md` and `.yml`/`.yaml` files in the `.gauntlet/reviews/` directory. The review name MUST be derived from the filename (without extension). If both a `.md` and `.yml`/`.yaml` file exist with the same base name, the system MUST reject the configuration with an error.

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

#### Scenario: YAML review must specify exactly one prompt source
- **GIVEN** a file `.gauntlet/reviews/invalid.yml` with both `prompt_file` and `skill_name`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: YAML review with neither prompt source
- **GIVEN** a file `.gauntlet/reviews/empty.yml` with neither `prompt_file` nor `skill_name`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: Duplicate review name across formats
- **GIVEN** both `.gauntlet/reviews/security.md` and `.gauntlet/reviews/security.yml` exist
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a duplicate name error

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

