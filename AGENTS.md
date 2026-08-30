# General

## Workspace Context
For broader Codagent workspace context, see [../AGENTS.md](../AGENTS.md). Read it when the user mentions another Codagent repo or project.

## Project Overview
This project is “Agent Validator” (formerly Agent Gauntlet), a configurable “feedback loop” runner for AI-assisted development workflows.

The user configures which paths in their repo should trigger which validations — shell commands like tests and linters, plus AI-powered code reviews. When files change, Agent Validator automatically runs the relevant validations and reports results.

### Structure
- `src/`: Source code
  - `commands/`: CLI command implementations
  - `core/`: Core application logic
  - `gates/`: Validation checks and quality gates
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

## Validation and releases
- Run `bun run test` and `bun run test:e2e` before a release.
- When validating Agent Validator itself, build the current checkout and invoke it directly with `bun run build:npm && node dist/index.js run`. Do not use an `agent-validator` command from `PATH`, which may resolve to a different installation.
- Follow `.claude/commands/release.md` to prepare a release. The contributor-facing release and recovery runbook is in `docs/development.md`.

## Skill source of truth
The distributable skill source is the `skills/` directory at the repo root. Each skill lives in `skills/validator-<action>/` as static files. `init.ts` copies these into consumer projects via `installSkillsWithChecksums()`.
