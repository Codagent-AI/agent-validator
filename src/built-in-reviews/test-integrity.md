# Test Integrity Review

Review modified test files for changes that weaken coverage — particularly where an agent may have silenced a failing test instead of fixing the underlying bug.

## Context

When AI agents introduce bugs, they sometimes resolve test failures by modifying the test rather than fixing the implementation. The result is code that passes CI but ships broken behavior. This review looks for that pattern by cross-referencing test changes against implementation changes in the same diff.

## Reasoning Format

For each suspicious test change, structure your analysis as:

1. **What the test previously verified** — describe the behavior or contract the original assertion was checking (use the `-` lines in the diff)
2. **What the implementation changed** — summarize the relevant implementation diff and whether the behavior change looks intentional or like a regression
3. **Whether the test change is justified** — does the test change reflect a deliberate design decision, or does it weaken coverage to hide a failure?

This format structures your thinking — it is not a gate. If you cannot complete a step with certainty, still report the issue and note what is uncertain.

## Patterns to Flag

- **Weakened assertions** — assertions replaced with less specific ones (e.g., `toBe(42)` → `toBeDefined()`, `toEqual({...})` → `toBeTruthy()`, `toThrow('specific message')` → `toThrow()`)
- **Changed expected values** — expected values updated to match new output when the implementation change looks like a bug, not an intentional behavior change
- **Removed assertions** — `expect(...)` calls deleted alongside an implementation change that touches the same code path
- **Skipped or deleted tests** — `test.skip()`, `xit()`, commented-out tests, or test file deletions that coincide with implementation changes in the related code
- **Narrowed test scope** — fewer test cases, removed edge cases, or removed input variants that the new implementation no longer handles correctly
- **Mock behavior adjusted to hide failures** — mock return values or stub behavior changed in a way that accommodates a new failure rather than reflecting intended behavior

## Do NOT Report

- Test updates where the implementation change is clearly intentional and the test correctly reflects the new contract
- New tests added alongside implementation changes
- Test refactors (renamed variables, restructured setup/teardown) that preserve assertion strength
- Removed tests for deleted functionality
- Style or formatting changes in test files
- Code not changed in this diff

## Guidelines

- **Threshold**: could the test change allow a real behavioral regression to ship undetected? Focus on assertion strength — a test that still runs but no longer catches the bug is the core risk.
- Cross-reference the test diff with the implementation diff. A suspicious test change in isolation is not enough — there must be a plausible implementation bug it could be hiding.
- When uncertain, report it with low priority and explain what would need to be true for it to be a real problem.
- Provide a **concrete fix** showing what the test should assert if the implementation were correct.
