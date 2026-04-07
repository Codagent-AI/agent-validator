# inline-check-config Specification

## Purpose
Defines inline check gate configuration within entry_points in config.yml as an alternative to separate check files.

## ADDED Requirements

### Requirement: Entry points support inline check definitions in their checks array
The system MUST support inline check definitions within each entry point's `checks` array. Each inline item is a single-key object where the key is the check name and the value is a check configuration object using the same schema as `.validator/checks/*.yml` files. Inline checks and file-based checks are merged at load time; if the same name appears in both sources, the system MUST reject with a validation error. A check name may only be defined inline in one entry point; other entry points reference it by name as a string.

#### Scenario: Inline check is available for execution
- **WHEN** an entry point's `checks` array contains an inline object `build` with a valid command
- **THEN** the system loads the `build` check from the inline definition
- **AND** the check executes with the configured command

#### Scenario: Minimal inline check requires only command
- **WHEN** an inline check specifies only `command`
- **THEN** the system applies all other attribute defaults (parallel: true, run_in_ci: true, run_locally: true)
- **AND** the check executes successfully

#### Scenario: Inline check with non-default attributes
- **WHEN** an inline check specifies `command`, `parallel: true`, and `timeout: 60`
- **THEN** the check runs with parallel execution enabled and a 60-second timeout

#### Scenario: Name collision between inline and file-based check
- **WHEN** an entry point defines an inline check named `lint`
- **AND** `.validator/checks/lint.yml` also exists
- **THEN** the system MUST reject config loading with a validation error naming the conflicting check

#### Scenario: File-based checks coexist with inline checks
- **WHEN** an entry point defines inline check `build`
- **AND** `.validator/checks/lint.yml` exists
- **AND** the same entry point lists both `build` (inline) and `lint` (string reference)
- **THEN** both checks run: `build` from inline config, `lint` from file

#### Scenario: Duplicate inline check across entry points
- **WHEN** two entry points each define an inline check named `build`
- **THEN** the system MUST reject config loading with a validation error

#### Scenario: Cross-entry-point reference by name
- **WHEN** entry point A defines inline check `build`
- **AND** entry point B lists `build` as a string reference
- **THEN** entry point B uses the check definition from entry point A

#### Scenario: Invalid inline check produces validation error
- **WHEN** an inline check is missing the required `command` field
- **THEN** the system MUST reject config loading with a validation error

### Requirement: Top-level checks map is NOT allowed
The system MUST reject a `checks` key at the top level of `config.yml`. Check definitions belong either as files in `.validator/checks/` or inline within entry points.
