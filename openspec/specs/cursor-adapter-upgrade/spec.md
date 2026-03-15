# cursor-adapter-upgrade Specification

## Purpose
TBD - created by archiving change cursor-coding-agent-support. Update Purpose after archive.
## Requirements
### Requirement: Skill directory support

The `CursorAdapter` SHALL expose project-level and user-level skill directories so that skills can be installed for Cursor.

#### Scenario: Project skill dir returned
- **WHEN** `getProjectSkillDir()` is called
- **THEN** it SHALL return a non-null path where project-scoped skills are stored for Cursor

#### Scenario: User skill dir returned
- **WHEN** `getUserSkillDir()` is called
- **THEN** it SHALL return a non-null path where user-scoped skills are stored for Cursor

