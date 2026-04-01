## ADDED Requirements

### Requirement: Config supports a top-level reviews map for inline review definitions
The system MUST support an optional top-level `reviews` map in `config.yml`. Each key is a review name and each value is a review configuration object using the same schema as `.validator/reviews/*.yml` files (one of `builtin`/`prompt_file`/`skill_name` plus optional attributes). Inline reviews and file-based reviews are merged at load time; if the same name appears in both sources, the system MUST reject with a validation error.

#### Scenario: Inline review is available for entry point reference
- **WHEN** `config.yml` contains a `reviews` map with key `code-quality` and `builtin: code-quality`
- **AND** an entry point lists `code-quality` in its reviews array
- **THEN** the system loads the `code-quality` review from the inline definition

#### Scenario: Minimal inline review requires only a prompt source
- **WHEN** an inline review specifies only `builtin: code-quality`
- **THEN** the system applies all other attribute defaults (num_reviews: 1, parallel: true, run_in_ci: true, run_locally: true, enabled: true)

#### Scenario: Name collision between inline and file-based review
- **WHEN** `config.yml` defines an inline review named `code-quality`
- **AND** `.validator/reviews/code-quality.yml` also exists
- **THEN** the system MUST reject config loading with a validation error naming the conflicting review

#### Scenario: File-based reviews coexist with inline reviews
- **WHEN** `config.yml` defines inline review `code-quality`
- **AND** `.validator/reviews/security.md` exists
- **AND** an entry point lists both
- **THEN** both reviews run: `code-quality` from inline config, `security` from file

#### Scenario: Invalid inline review produces validation error
- **WHEN** an inline review specifies none of `builtin`, `prompt_file`, or `skill_name`
- **THEN** the system MUST reject config loading with a validation error
