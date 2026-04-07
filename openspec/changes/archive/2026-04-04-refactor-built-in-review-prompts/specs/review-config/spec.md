## MODIFIED Requirements

### Requirement: Built-in review prompts are pure markdown
Built-in review prompts bundled with the package MUST be pure markdown files with no YAML frontmatter. They contain only the prompt text. All configuration settings (num_reviews, cli_preference, etc.) MUST be specified in the YAML review config file that references the built-in. The package SHALL ship three built-in reviews: `code-quality`, `security`, and `error-handling`. All built-in reviewers SHALL prioritize recall over precision — when uncertain, the reviewer reports the issue rather than suppressing it.

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

#### Scenario: Unknown built-in name rejected
- **GIVEN** a YAML review config with `builtin: nonexistent`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with an error indicating the built-in review "nonexistent" is unknown
