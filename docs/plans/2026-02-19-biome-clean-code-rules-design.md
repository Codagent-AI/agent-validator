# Replace CodeScene with Biome Clean Code Rules

## Summary

Drop CodeScene as the `code-health` gate and replace it with extended Biome linter rules that enforce SOLID and clean code principles. This consolidates two overlapping tools (Biome + CodeScene) into one, eliminates a commercial dependency, and makes code health enforcement run in both local and CI environments.

## What Changes

1. **Upgrade Biome** from 2.3.11 to 2.4.3 (already done during research).
2. **Update `biome.json`** — add complexity, readability, and structural rules at `error` level.
3. **Fix all ~94 existing violations** across the codebase.
4. **Remove the `code-health` gate** — delete `.validator/checks/code-health.yml` and remove `code-health` from entry points in `.validator/config.yml`.
5. **Update openspec pre-factoring** — replace CodeScene MCP references with Biome-based analysis in `openspec/AGENTS.md`.

## New Biome Rules

### Complexity (code health — replaces CodeScene)

| Rule | Level | Options |
|------|-------|---------|
| `noExcessiveCognitiveComplexity` | error | `maxAllowedComplexity: 15` |
| `noExcessiveLinesPerFunction` | error | `maxLines: 75` |
| `noExcessiveNestedTestSuites` | error | — |
| `noForEach` | error | — |
| `useSimplifiedLogicExpression` | error | — |

### Style (readability)

| Rule | Level |
|------|-------|
| `noNestedTernary` | error |
| `noUselessElse` | error |
| `useCollapsedElseIf` | error |
| `noParameterAssign` | error |
| `noNegationElse` | error |
| `noYodaExpression` | error |
| `useExplicitLengthCheck` | error |
| `noShoutyConstants` | error |

### Suspicious

| Rule | Level |
|------|-------|
| `noImportCycles` | error |

### Nursery (experimental — may change between Biome versions)

| Rule | Level | Options |
|------|-------|---------|
| `noExcessiveLinesPerFile` | error | `maxLines: 500` |
| `noExcessiveClassesPerFile` | error | `maxClasses: 1` |
| `noNestedPromises` | error | — |
| `noUselessReturn` | error | — |

## Existing Violations to Fix

94 total violations (measured against current codebase):

| Rule | Count | Fixable? |
|------|-------|----------|
| `noExcessiveCognitiveComplexity` | 24 | Refactoring |
| `noExcessiveLinesPerFunction` | 20 | Refactoring |
| `useSimplifiedLogicExpression` | 18 | Auto-fix |
| `noForEach` | 12 | Mechanical |
| `noNestedTernary` | 6 | Extract to variables/if-else |
| `noExcessiveLinesPerFile` | 6 | File splitting |
| `noNegationElse` | 3 | Auto-fix |
| `noUselessElse` | 2 | Auto-fix |
| `useExplicitLengthCheck` | 1 | Auto-fix |
| `useCollapsedElseIf` | 1 | Trivial |
| `noNestedPromises` | 1 | Trivial |

Heaviest refactoring targets:
- `src/commands/check.ts` — cognitive complexity 79, 247 lines
- `src/commands/review.ts` — cognitive complexity 79, 247 lines
- `src/commands/health.ts` — cognitive complexity 59
- `src/gates/review.ts` — multiple functions over threshold
- `src/utils/log-parser.ts` — multiple parser functions over threshold

## Rules Not Adopted

- `useNamingConvention` — 243 violations, needs per-selector configuration to reduce noise
- `useBlockStatements` — 168 violations, debatable style choice for single-line returns
- `useFilenamingConvention` — 0 violations but low value, already consistent
