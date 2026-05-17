# init-checksums Specification

## Purpose
Checksum computation utilities for Agent Validator skill bundles.
## Requirements
### Requirement: Checksum computation for skills

Skill checksums SHALL be computed over the combined content of all files in the skill directory (SKILL.md + references/*), providing a single checksum per skill.

#### Scenario: Single-file skill checksum
- **GIVEN** a skill directory contains only `SKILL.md`
- **WHEN** the checksum is computed
- **THEN** it SHALL be the hash of `SKILL.md` content

#### Scenario: Multi-file skill checksum
- **GIVEN** a skill directory contains `SKILL.md` and `references/config.md`
- **WHEN** the checksum is computed
- **THEN** it SHALL be the hash of the concatenated content of all files (sorted by path for determinism)
