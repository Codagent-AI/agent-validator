## MODIFIED Requirements
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
