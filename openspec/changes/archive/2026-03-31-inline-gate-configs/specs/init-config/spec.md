## MODIFIED Requirements

### Requirement: Init generates YAML review config with built-in reference
The `init` command SHALL write a `code-quality` review entry inline in `config.yml` under the top-level `reviews` map, referencing the built-in code-quality prompt. The `init` command SHALL NOT create `.validator/reviews/code-quality.yml`, SHALL NOT create the `.validator/reviews/` directory, and SHALL NOT create the `.validator/checks/` directory.

#### Scenario: Default init writes code-quality review inline
- **WHEN** a user runs `agent-validate init`
- **THEN** `config.yml` SHALL contain a `reviews` map with `code-quality: {builtin: code-quality, num_reviews: 1}`
- **AND** `.validator/reviews/code-quality.yml` SHALL NOT be created
- **AND** `.validator/reviews/` SHALL NOT be created
- **AND** `.validator/checks/` SHALL NOT be created

#### Scenario: Init with --yes flag writes code-quality inline
- **WHEN** a user runs `agent-validate init --yes`
- **THEN** `config.yml` SHALL contain a `reviews` map with `code-quality: {builtin: code-quality, num_reviews: 1}`
- **AND** no separate review file SHALL be created

#### Scenario: Init re-run preserves existing inline reviews
- **WHEN** `config.yml` already contains a `reviews` map
- **AND** the user runs `agent-validate init`
- **THEN** the existing `reviews` map SHALL be preserved (not overwritten)

#### Scenario: Init re-run does not delete existing reviews or checks directories
- **WHEN** `.validator/reviews/` or `.validator/checks/` already exist
- **AND** the user runs `agent-validate init`
- **THEN** both directories SHALL be left as-is
