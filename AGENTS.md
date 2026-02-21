# General

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

## CRITICAL: Never use background subagents
**NEVER use `run_in_background: true` with the Task tool. NEVER use TaskOutput.** Always use synchronous Task calls. This is non-negotiable — do not "optimize" by parallelizing subagents in the background, even if tasks appear independent. There is a known bug in Claude Code's TaskOutput retrieval path that returns raw JSONL transcript garbage instead of the subagent's actual answer. Synchronous Task calls work correctly. Background ones do not. Do not improvise around this rule.

## Skill source of truth
The canonical skill source is the `skills/` directory at the repo root. Each skill lives in `skills/gauntlet-<action>/` as static files. `init.ts` copies these into consumer projects via `installSkillsWithChecksums()`.

When updating a skill, edit the files in `skills/gauntlet-<action>/`. The local copy in `.claude/skills/` (used by this project) may differ slightly — it is not the distributable source.

# Spec-driven development with OpenSpec and Superpowers

## Planning with superpowers
- The openspec change directory is the source of truth for planning. When using `writing-plan` skill, read all files in `openspec/changes/<change-name>/` (proposal.md, design.md, and spec deltas), not the brainstorm design doc in docs/plans/.
- When applicable, the plan should include a task for updating any user-facing docs in `docs/` (quick-start.md, user-guide.md, skills-guide.md, config-reference.md) to reflect the changes.
- When applicable, plan should also include a task for archiving the openspec change, see `.claude/commands/openspec/archive.md`.

## Agent-triggered workflows
- After drafting an openspec proposal, use the `gauntlet-run` skill to verify correctness.
- After writing a design doc from brainstorming, do NOT proceed to implementation. Give the user the file path and ask them to review it before continuing.
- After writing a plan with `writing-plans` skill, automatically execute it using subagent-driven-development. Do not ask which execution option to use.
- When implementation is complete, run the `gauntlet-run` skill to verify correctness. Then the `push-pr` skill. Do not use finishing-a-development-branch.
