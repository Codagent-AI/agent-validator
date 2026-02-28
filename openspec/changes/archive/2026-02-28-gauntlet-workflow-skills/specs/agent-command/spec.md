## MODIFIED Requirements

### Requirement: Gauntlet Help Diagnostic Skill

The system SHALL provide a `/gauntlet-help` skill for evidence-based diagnosis of gauntlet behavior. The skill SHALL be diagnosis-only (no auto-fix behavior) and SHALL operate without requiring source code access. After completing a diagnosis, the skill SHALL route to bug filing based on confidence level: automatically invoking `gauntlet-issue` on high-confidence bug diagnoses, prompting the user on medium confidence, and taking no action on low confidence.

#### Scenario: Diagnose a "no changes" question from runtime evidence

- **GIVEN** a user asks "/gauntlet-help: the hook reported no changes, why?"
- **WHEN** the skill investigates
- **THEN** it SHALL resolve `log_dir` from `.gauntlet/config.yml`
- **AND** inspect runtime evidence from `<log_dir>/.debug.log`, `<log_dir>/.execution_state`, and relevant gate/review logs
- **AND** return a structured response including Diagnosis, Evidence, Confidence (`high`/`medium`/`low`), and Next steps

#### Scenario: High-confidence bug diagnosis

- **WHEN** the skill completes a diagnosis with confidence level High
- **AND** the diagnosis indicates a likely bug in agent-gauntlet (not a configuration or user error)
- **THEN** the skill SHALL automatically invoke `gauntlet-issue`
- **AND** SHALL pass the diagnosis summary as the bug description

#### Scenario: High-confidence non-bug diagnosis

- **WHEN** the skill completes a diagnosis with confidence level High
- **AND** the diagnosis indicates a configuration issue, user error, or expected behavior
- **THEN** the skill SHALL NOT invoke `gauntlet-issue`

#### Scenario: Medium-confidence possible bug

- **WHEN** the skill completes a diagnosis with confidence level Medium
- **AND** the evidence suggests a possible gauntlet bug
- **THEN** the skill SHALL ask the user: "This may be a gauntlet bug. Want me to file a GitHub issue?"
- **AND** if the user confirms, SHALL invoke `gauntlet-issue` with the diagnosis as the bug description
- **AND** if the user declines, SHALL exit without filing

#### Scenario: Low-confidence diagnosis

- **WHEN** the skill completes a diagnosis with confidence level Low
- **THEN** the skill SHALL NOT prompt the user to file an issue
- **AND** SHALL NOT invoke `gauntlet-issue`
