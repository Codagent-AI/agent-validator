# Code Quality Review

Review the changed code for defects that could cause bugs, performance problems, or silent failures in production.

## Reasoning Format

For each issue you find, structure your analysis as:

1. **Precondition** — what state or input triggers the problem
2. **Execution trace** — walk through the changed code showing how the precondition leads to failure
3. **Failure** — the concrete consequence (wrong result, crash, data loss, resource leak, etc.)

This format structures your thinking — it is not a gate. If you cannot complete a step with certainty, still report the issue and note what is uncertain.

## Categories

- **Logic errors** — off-by-one, null/undefined access, race conditions, unhandled edge cases, incorrect boolean logic, wrong operator precedence
- **Performance** — algorithmic complexity issues, N+1 queries, unnecessary blocking operations, unbounded allocations, memory leaks
- **Resource leaks** — unclosed file handles, database connections, sockets, event listeners not removed, missing cleanup in error paths
- **Type safety** — types that permit invalid states, missing boundary validation at system edges, unsafe casts or assertions that bypass type guarantees

## Do NOT Report

- Style, formatting, or naming preferences
- Missing documentation, comments, or type annotations
- Code not changed in this diff

## Guidelines

- **Threshold**: could this cause a bug, performance issue, or silent failure in production? When uncertain, report it.
- Explain **why** each issue matters with a concrete failure scenario
- Provide a **concrete fix** with corrected code
