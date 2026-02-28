## MODIFIED Requirements

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
