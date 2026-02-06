## ADDED Requirements

### Requirement: Built-in reviews can be referenced via built-in prefix
The system MUST support a `built-in:<name>` syntax in entry point review references. When a review reference uses this prefix, the system MUST resolve the review from the package's bundled reviews instead of from `.gauntlet/reviews/`. Built-in reviews MUST be stored in the `reviews` record under their full `built-in:<name>` key to avoid collisions with user-defined reviews. User-defined review filenames MUST NOT start with the `built-in:` prefix; the loader MUST reject any such file with an error to prevent silent key collisions.

#### Scenario: Built-in review loads successfully
- **GIVEN** a `config.yml` with entry point:
  ```yaml
  entry_points:
    - path: "."
      reviews:
        - built-in:code-quality
  ```
- **WHEN** the configuration is loaded
- **THEN** the review `built-in:code-quality` SHALL be available in the loaded config
- **AND** it SHALL have `promptContent` containing the bundled code quality review prompt
- **AND** it SHALL have `prompt` set to `"built-in:code-quality"`
- **AND** it SHALL have `isBuiltIn` set to `true`

#### Scenario: Unknown built-in review rejected
- **GIVEN** a `config.yml` referencing `built-in:nonexistent`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with an error: `Unknown built-in review: "nonexistent"`

#### Scenario: Built-in and user reviews coexist
- **GIVEN** a `config.yml` with entry point:
  ```yaml
  entry_points:
    - path: "."
      reviews:
        - built-in:code-quality
        - my-custom-review
  ```
- **AND** `.gauntlet/reviews/my-custom-review.md` exists
- **WHEN** the configuration is loaded
- **THEN** both `built-in:code-quality` and `my-custom-review` SHALL be available
- **AND** they SHALL be independent entries in the reviews record

#### Scenario: User review named code-quality coexists with built-in:code-quality
- **GIVEN** a `config.yml` with entry point referencing both `built-in:code-quality` and `code-quality`
- **AND** `.gauntlet/reviews/code-quality.md` exists
- **WHEN** the configuration is loaded
- **THEN** both SHALL be independent entries keyed as `built-in:code-quality` and `code-quality` respectively

#### Scenario: CLI preference merging applies to built-in reviews
- **GIVEN** a `config.yml` with `cli.default_preference: [claude, gemini]`
- **AND** an entry point referencing `built-in:code-quality`
- **AND** the built-in review does not specify `cli_preference`
- **WHEN** the configuration is loaded
- **THEN** the built-in review SHALL inherit `cli_preference` from `cli.default_preference`

#### Scenario: Entry point referencing built-in review passes validation
- **GIVEN** a `config.yml` with entry point referencing `built-in:code-quality`
- **WHEN** the configuration is loaded
- **THEN** no entry point validation error SHALL be raised
- **AND** the built-in review SHALL be resolved before entry point references are validated

#### Scenario: User-defined review file with built-in prefix rejected
- **GIVEN** a file `.gauntlet/reviews/built-in:code-quality.md` exists
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with an error indicating the `built-in:` prefix is reserved

### Requirement: Built-in code-quality review ships with package
The package MUST include a `code-quality` built-in review that provides a generic code quality review prompt. This review MUST use the same frontmatter + markdown body format as user-defined reviews, parsed with `gray-matter`. Default values (such as `num_reviews`, `parallel`, `run_in_ci`, `run_locally`) MUST come from the frontmatter of the bundled `.md` file, parsed identically to user reviews via `gray-matter` and the existing schema defaults. The prompt content MUST cover bugs, security, maintainability, and performance concerns.

#### Scenario: Code-quality review has expected defaults
- **GIVEN** the built-in `code-quality` review is loaded
- **THEN** `num_reviews` SHALL default to `1`
- **AND** `parallel` SHALL default to `true`
- **AND** `run_in_ci` SHALL default to `true`
- **AND** `run_locally` SHALL default to `true`
- **AND** `promptContent` SHALL contain review instructions covering bugs, security, maintainability, and performance
