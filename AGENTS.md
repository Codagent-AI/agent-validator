# Development

## Project Overview
This project is "Agent Gauntlet", a configurable “feedback loop” runner for AI-assisted development workflows.

The user configures which paths in their repo should trigger which validations — shell commands like tests and linters, plus AI-powered code reviews. When files change, Gauntlet automatically runs the relevant validations and reports results.

### Structure
- `src/`: Source code
  - `commands/`: CLI command implementations
  - `core/`: Core application logic
  - `gates/`: Validation checks and quality gates
  - `hooks/`: Lifecycle hooks (e.g., stop hooks)
- `test/`: Test suite
- `bin/`: Compiled binary output
- `docs/`: Documentation

## Tech Stack
- **Runtime**: [Bun](https://bun.sh) (v1.0+)
- **Language**: TypeScript (ESM)
- **Frameworks**: Commander.js (CLI), Zod (Validation), Biome (Linting/Formatting)

## Code Style
- Write clean, DRY code.
- Prefer functional patterns where appropriate.

## Agent-triggered workflows
- After completing an openspec proposal, use the `gauntlet-run` skill to verify correctness.
- After writing a plan with `writing-plans` skill, automatically execute it using subagent-driven-development. Do not ask which execution option to use.
- When implementation is complete, run the `gauntlet-run` skill to verify correctness. Then the `push-pr` skill. Do not use finishing-a-development-branch.

## Planning with superpowers
- The openspec change directory is the source of truth for planning. When using `writing-plan` skill, read all files in `openspec/changes/<change-name>/` (proposal.md, design.md, and spec deltas), not the brainstorm design doc in docs/plans/.
- If design.md contains a `## Pre-factoring` section with hotspot refactorings, the plan's first task should be those refactorings — complete them before starting implementation work.
- When applicable, the plan should include a task for updating any user-facing docs in `docs/` (quick-start.md, user-guide.md, skills-guide.md, config-reference.md) to reflect the changes.
- When applicable, plan should also include a task for archiving the openspec change, see `.agent/workflows/openspec-archive.md`.

## Subagent-driven development: gauntlet as quality gate
When running subagent-driven-development, do NOT dispatch the code quality reviewer subagent from superpowers. Instead, after the spec compliance reviewer passes, dispatch a subagent that runs `agent-gauntlet run` and reports the results. Use its output as the quality gate:
- If gauntlet passes: mark the quality review as passed and proceed to the next task.
- If gauntlet fails: relay the specific failures to the implementer subagent for fixing, then re-run gauntlet after fixes are committed.
