<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Development

## Tech Stack
- **Runtime**: [Bun](https://bun.sh) (v1.0+)
- **Language**: TypeScript (ESM)
- **Linter/Formatter**: [Biome](https://biomejs.dev)
- **CLI Framework**: Commander.js

## Code Style
- Use strict TypeScript.
- Prefer functional patterns where appropriate.
- Keep CLI commands in `src/commands`.

## Code Health (CodeScene)

When the `code-health` check fails:

1. **Make a reasonable attempt to fix issues** - Address complexity, duplication, and other code smells where the fix is straightforward and improves the code.

2. **Document deferred issues** in `docs/code-health-improvements.md`:
   - What the issue is and which file/function
   - Why it's being deferred (e.g., too complex, acceptable trade-off, test code)
   - Suggested fix for future work

3. **Acceptable to defer:**
   - Style metrics that don't affect functionality (e.g., string-heavy arguments)
   - Test file duplication (test readability > DRY)
   - Issues requiring significant refactoring unrelated to current work

4. **Should fix:**
   - High cyclomatic complexity in new code
   - Code duplication in production code (not tests)
   - Issues that can be fixed with simple refactoring

CodeScene thresholds are guidelines, not hard rules. Use judgment.