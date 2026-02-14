## ADDED Requirements

### Requirement: Gauntlet Help Diagnostic Skill
The system SHALL provide a `/gauntlet-help` skill for evidence-based diagnosis of gauntlet behavior. The skill SHALL be diagnosis-only (no auto-fix behavior) and SHALL operate without requiring source code access.

#### Scenario: Diagnose a "no changes" question from runtime evidence
- **GIVEN** a user asks "/gauntlet-help: the hook reported no changes, why?"
- **WHEN** the skill investigates
- **THEN** it SHALL resolve `log_dir` from `.gauntlet/config.yml`
- **AND** inspect runtime evidence from `<log_dir>/.debug.log`, `<log_dir>/.execution_state`, and relevant gate/review logs
- **AND** return a structured response including Diagnosis, Evidence, Confidence (`high`/`medium`/`low`), and Next steps

### Requirement: Situation-Based Skill Structure
The `gauntlet-help` skill SHALL use a multi-file structure with `SKILL.md` containing always-needed content (evidence sources, output contract, diagnostic workflow, routing logic) and situation-based reference files under `references/` organized by troubleshooting domain.

#### Scenario: Router selects only needed reference for a stop-hook question
- **GIVEN** the `gauntlet-help` skill bundle is installed
- **WHEN** the user asks why the stop hook blocked their stop
- **THEN** `SKILL.md` SHALL route to `references/stop-hook-troubleshooting.md`
- **AND** the skill SHALL remain prompt-only (no bundled executable scripts)

#### Scenario: Router selects only needed reference for a config question
- **GIVEN** the `gauntlet-help` skill bundle is installed
- **WHEN** the user asks about a config validation error
- **THEN** `SKILL.md` SHALL route to `references/config-troubleshooting.md`

### Requirement: Comprehensive Diagnostic Playbooks
The `gauntlet-help` skill SHALL provide situation-based troubleshooting references that cover all gauntlet stop-hook statuses, config issues, gate failures, lock conflicts, adapter health, and CI/PR integration, and SHALL use dynamic evidence acquisition to gather only the additional signals needed for diagnosis.

#### Scenario: Explain any stop-hook outcome with targeted evidence gathering
- **GIVEN** a user asks why the stop hook allowed or blocked
- **WHEN** logs/state do not provide enough evidence for a confident explanation
- **THEN** the skill SHALL run one or more of `agent-gauntlet list`, `agent-gauntlet health`, and `agent-gauntlet detect` as needed
- **AND** it SHALL explain the observed result using the relevant troubleshooting reference
