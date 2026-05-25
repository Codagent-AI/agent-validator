## MODIFIED Requirements

### Requirement: Reviews support YAML configuration files
The system MUST load review configurations from both `.md` and `.yml`/`.yaml` files in the `.validator/reviews/` directory. The review name MUST be derived from the filename (without extension). If both a `.md` and `.yml`/`.yaml` file exist with the same base name, the system MUST reject the configuration with an error. Reviews MAY also be defined inline in `config.yml` under the top-level `reviews` map (see inline-review-config capability). File-based reviews and inline reviews are merged; a name present in both sources MUST cause a validation error.

YAML review files MUST specify exactly one of `prompt_file`, `skill_name`, or `builtin`. These three attributes are mutually exclusive. When `builtin` is specified, the prompt content MUST be loaded from the package's built-in review registry.

All review file formats (`.md` frontmatter and `.yml`/`.yaml`) MUST support an `enabled` boolean attribute that defaults to `true`. When `enabled` is `false`, the review is opt-in and SHALL only run when explicitly activated via the `--enable-review` CLI option.

All review file formats MUST support an optional `one_shot` boolean attribute. When omitted, the default value SHALL be `false`, except when the resolved `builtin` is `task-compliance`, in which case the default SHALL be `true`. An explicit `one_shot: false` on a `builtin: task-compliance` review SHALL override the default and disable one-shot behaviour for that review. When `one_shot` is `true`, the review's rerun behaviour follows the rules in the run-lifecycle capability ("One-shot review suppression on rerun"). The `one_shot` attribute SHALL be exposed on the loaded review config so downstream code (job generation, review dispatch) can read it.

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
- **AND** `one_shot` defaults to `false`

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

#### Scenario: YAML review with builtin task-compliance defaults one_shot to true
- **GIVEN** a file `.validator/reviews/task-compliance.yml` with content:
  ```yaml
  builtin: task-compliance
  enabled: false
  ```
- **WHEN** the configuration is loaded
- **THEN** the loaded review SHALL have `one_shot` set to `true`
- **AND** the loaded review SHALL have `enabled` set to `false`

#### Scenario: YAML review with builtin task-compliance honours explicit one_shot false
- **GIVEN** a file `.validator/reviews/task-compliance.yml` with content:
  ```yaml
  builtin: task-compliance
  enabled: false
  one_shot: false
  ```
- **WHEN** the configuration is loaded
- **THEN** the loaded review SHALL have `one_shot` set to `false`

#### Scenario: YAML review with non-task-compliance builtin defaults one_shot to false
- **GIVEN** a file `.validator/reviews/code-quality.yml` with content:
  ```yaml
  builtin: code-quality
  ```
- **WHEN** the configuration is loaded
- **THEN** the loaded review SHALL have `one_shot` set to `false`

#### Scenario: YAML review with explicit one_shot true on user-defined prompt
- **GIVEN** a file `.validator/reviews/acceptance.yml` with content:
  ```yaml
  prompt_file: prompts/acceptance.md
  one_shot: true
  ```
- **AND** `.validator/prompts/acceptance.md` exists
- **WHEN** the configuration is loaded
- **THEN** the loaded review SHALL have `one_shot` set to `true`

#### Scenario: Markdown review with one_shot true in frontmatter
- **GIVEN** a file `.validator/reviews/acceptance.md` with frontmatter containing `one_shot: true`
- **WHEN** the configuration is loaded
- **THEN** the loaded review SHALL have `one_shot` set to `true`

#### Scenario: Inline review with one_shot true
- **GIVEN** `config.yml` defines an inline review:
  ```yaml
  reviews:
    acceptance:
      prompt_file: prompts/acceptance.md
      one_shot: true
  ```
- **WHEN** the configuration is loaded
- **THEN** the loaded review "acceptance" SHALL have `one_shot` set to `true`
