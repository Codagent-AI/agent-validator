## ADDED Requirements

### Requirement: Config supports a top-level checks map for inline check definitions
The system MUST support an optional top-level `checks` map in `config.yml`. Each key is a check name and each value is a check configuration object using the same schema as `.validator/checks/*.yml` files. Inline checks and file-based checks are merged at load time; if the same name appears in both sources, the system MUST reject with a validation error.

#### Scenario: Inline check is available for entry point reference
- **WHEN** `config.yml` contains a `checks` map with key `build` and valid command
- **AND** an entry point lists `build` in its checks array
- **THEN** the system loads the `build` check from the inline definition
- **AND** the check executes with the configured command

#### Scenario: Minimal inline check requires only command
- **WHEN** an inline check specifies only `command`
- **THEN** the system applies all other attribute defaults (parallel: false, run_in_ci: true, run_locally: true)
- **AND** the check executes successfully

#### Scenario: Inline check with non-default attributes
- **WHEN** an inline check specifies `command`, `parallel: true`, and `timeout: 60`
- **THEN** the check runs with parallel execution enabled and a 60-second timeout

#### Scenario: Name collision between inline and file-based check
- **WHEN** `config.yml` defines an inline check named `lint`
- **AND** `.validator/checks/lint.yml` also exists
- **THEN** the system MUST reject config loading with a validation error naming the conflicting check

#### Scenario: File-based checks coexist with inline checks
- **WHEN** `config.yml` defines inline check `build`
- **AND** `.validator/checks/lint.yml` exists
- **AND** an entry point lists both `build` and `lint`
- **THEN** both checks run: `build` from inline config, `lint` from file

#### Scenario: Invalid inline check produces validation error
- **WHEN** an inline check is missing the required `command` field
- **THEN** the system MUST reject config loading with a validation error
