# Project Context

## Purpose
Agent Gauntlet is a CLI that runs configurable quality gates (tests, linters, type checks)
and AI code reviews based on detected git changes. It is designed to support AI-assisted
development loops, multi-agent review, and CI usage with minimal setup.

## Tech Stack
- TypeScript (ESM, strict mode)
- Bun runtime and toolchain (bun build, bun test)
- Commander for CLI command parsing
- Zod for config/schema validation
- YAML + gray-matter for config and review prompt parsing
- Chalk for terminal output
- Biome for linting/formatting

## Project Conventions

### Code Style
- Biome formatting: 2-space indentation, single quotes, semicolons
- TypeScript with strict compiler options (see `tsconfig.json`)
- ESM modules with explicit `.js` extensions in imports
- Tests use `*.test.ts` co-located under `src/`

### Architecture Patterns
- CLI entrypoint in `src/index.ts` registers subcommands via `src/commands/*`
- Core runtime in `src/core/*` (change detection, job generation, runner)
- Config parsing/validation in `src/config/*`
- Output/reporting in `src/output/*`
- Utilities in `src/utils/*`

### Testing Strategy
- Dogfood: follow the steps in `.claude/commands/dogfood.md` to run the full verification gauntlet and fix any issues

### Git Workflow
- Base branch for change detection defaults to `origin/main`
- Do not commit directly to main branch, use feature branches

## Domain Context
- Agent Gauntlet a feedback runner allowing projects to configure "gates".
- A "gate" is either a check (shell command) or a review (AI CLI prompt)
- Entry points define which paths trigger which gates via `.gauntlet/config.yml`
- Change detection relies on git diffs (committed + uncommitted locally; PR refs in CI)

## Important Constraints
- Requires Bun >= 1.0.0
- Review gates expect strict JSON output from AI CLIs
- CI integration targets GitHub Actions (generated workflow)

## External Dependencies
- Git (for change detection and diffs)
- Supported AI CLIs: `gemini`, `codex`, `claude`, `github-copilot`, `cursor`
