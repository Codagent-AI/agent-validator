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

## Verification
- NEVER manually run verification for your changes, a stop hook will trigger the gauntlet validation feedback loop.
