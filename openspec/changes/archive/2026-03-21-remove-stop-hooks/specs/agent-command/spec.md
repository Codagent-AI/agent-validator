## MODIFIED Requirements

### Requirement: Situation-Based Skill Structure
The `gauntlet-help` skill SHALL use a multi-file structure with `SKILL.md` containing always-needed content (evidence sources, output contract, diagnostic workflow, routing logic) and situation-based reference files under `references/` organized by troubleshooting domain.

#### Scenario: Router selects only needed reference for a config question
- **GIVEN** the `gauntlet-help` skill bundle is installed
- **WHEN** the user asks about a config validation error
- **THEN** `SKILL.md` SHALL route to `references/config-troubleshooting.md`

### Requirement: Comprehensive Diagnostic Playbooks
The `gauntlet-help` skill SHALL provide situation-based troubleshooting references that cover config issues, gate failures, lock conflicts, and adapter health, and SHALL use dynamic evidence acquisition to gather only the additional signals needed for diagnosis.

#### Scenario: Explain gate failures with targeted evidence gathering
- **GIVEN** a user asks why a gate failed
- **WHEN** logs/state do not provide enough evidence for a confident explanation
- **THEN** the skill SHALL run one or more of `agent-gauntlet list`, `agent-gauntlet health`, and `agent-gauntlet detect` as needed
- **AND** it SHALL explain the observed result using the relevant troubleshooting reference
