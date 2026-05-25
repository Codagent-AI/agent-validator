## MODIFIED Requirements

### Requirement: Task-compliance review defaults to disabled
The `task-compliance` review SHALL be configured as opt-in in this project, so it does not execute unless explicitly activated. When activated, callers SHOULD provide `--context-file` pointing to the task specification so the reviewer has the requirements to verify against.

The `task-compliance` review SHALL additionally default to one-shot behaviour (`one_shot: true`) as defined in the review-config and run-lifecycle capabilities. The default applies whenever a review's resolved prompt source is `builtin: task-compliance` and no explicit `one_shot` value is set in the review config. Users MAY override by setting `one_shot: false` explicitly. The `--enable-review task-compliance` flag SHALL NOT bypass one-shot suppression on reruns; it only governs activation of the disabled review for job generation.

#### Scenario: Task-compliance does not run without explicit activation
- **GIVEN** the `task-compliance` review is configured with `enabled: false` in this project
- **WHEN** the validator is run in this project without `--enable-review task-compliance`
- **THEN** the task-compliance review SHALL NOT execute

#### Scenario: Task-compliance activated with context file
- **GIVEN** the `task-compliance` review is configured with `enabled: false` in this project
- **WHEN** the validator is run with `--enable-review task-compliance --context-file path/to/task.md`
- **THEN** the task-compliance review SHALL execute with the task specification injected into the prompt

#### Scenario: Task-compliance is one-shot by default
- **GIVEN** a review config `task-compliance.yml` with `builtin: task-compliance` and no explicit `one_shot` field
- **WHEN** the configuration is loaded
- **THEN** the loaded review SHALL have `one_shot: true`
- **AND** on rerun, the validator SHALL apply one-shot suppression per the run-lifecycle capability

#### Scenario: Task-compliance with explicit one_shot false runs every iteration
- **GIVEN** a review config `task-compliance.yml` with `builtin: task-compliance` and `one_shot: false`
- **WHEN** the configuration is loaded
- **AND** the validator runs in rerun mode with prior task-compliance logs
- **THEN** the task-compliance review SHALL be dispatched in rerun-verification mode (existing behaviour for non-one-shot reviews)
