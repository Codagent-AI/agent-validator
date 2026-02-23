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

## Skill source of truth
The canonical skill source is the `skills/` directory at the repo root. Each skill lives in `skills/gauntlet-<action>/` as static files. `init.ts` copies these into consumer projects via `installSkillsWithChecksums()`.

When updating a skill, edit the files in `skills/gauntlet-<action>/`. The local copy in `.claude/skills/` (used by this project) may differ slightly — it is not the distributable source.
