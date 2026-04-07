# inline-review-config Specification

## Purpose
Defines inline review gate configuration within entry_points in config.yml as an alternative to separate review files.

## ADDED Requirements

### Requirement: Entry points support inline review definitions in their reviews array
The system MUST support inline review definitions within each entry point's `reviews` array. Each inline item is a single-key object where the key is the review name and the value is a review configuration object using the same schema as `.validator/reviews/*.yml` files (one of `builtin`/`prompt_file`/`skill_name` plus optional attributes). Inline reviews and file-based reviews are merged at load time; if the same name appears in both sources, the system MUST reject with a validation error. A review name may only be defined inline in one entry point; other entry points reference it by name as a string.

#### Scenario: Inline review is available for execution
- **WHEN** an entry point's `reviews` array contains an inline object `code-quality` with `builtin: code-quality`
- **THEN** the system loads the `code-quality` review from the inline definition

#### Scenario: Minimal inline review requires only a prompt source
- **WHEN** an inline review specifies only `builtin: code-quality`
- **THEN** the system applies all other attribute defaults (num_reviews: 1, parallel: true, run_in_ci: true, run_locally: true, enabled: true)

#### Scenario: Name collision between inline and file-based review
- **WHEN** an entry point defines an inline review named `code-quality`
- **AND** `.validator/reviews/code-quality.yml` also exists
- **THEN** the system MUST reject config loading with a validation error naming the conflicting review

#### Scenario: File-based reviews coexist with inline reviews
- **WHEN** an entry point defines inline review `code-quality`
- **AND** `.validator/reviews/security.md` exists
- **AND** the same entry point lists both
- **THEN** both reviews run: `code-quality` from inline config, `security` from file

#### Scenario: Duplicate inline review across entry points
- **WHEN** two entry points each define an inline review named `code-quality`
- **THEN** the system MUST reject config loading with a validation error

#### Scenario: Cross-entry-point reference by name
- **WHEN** entry point A defines inline review `code-quality`
- **AND** entry point B lists `code-quality` as a string reference
- **THEN** entry point B uses the review definition from entry point A

#### Scenario: Invalid inline review produces validation error
- **WHEN** an inline review specifies none of `builtin`, `prompt_file`, or `skill_name`
- **THEN** the system MUST reject config loading with a validation error

### Requirement: Top-level reviews map is NOT allowed
The system MUST reject a `reviews` key at the top level of `config.yml`. Review definitions belong either as files in `.validator/reviews/` or inline within entry points.
