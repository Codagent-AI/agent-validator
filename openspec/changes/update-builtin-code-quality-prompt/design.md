# Design: pr-review-toolkit Built-in Review

## Pre-factoring

Only one file is modified: `src/built-in-reviews/code-quality.md` (a markdown content file, not source code). No hotspots modified. CodeScene analysis is not applicable to markdown content files.

## Summary

Replace the `code-quality.md` built-in review prompt with a new prompt that leverages Claude's pr-review-toolkit plugin when available, falling back to an equivalent inline framework when the plugin is not installed.

## What Changes

**One file:** `src/built-in-reviews/code-quality.md`

Replace its contents with a prompt structured as:

1. **Primary path (pr-review-toolkit available):** Instruct Claude to use three specific agents to analyze the diff:
   - `code-reviewer` — general code quality, bug detection
   - `silent-failure-hunter` — swallowed errors, missing logging, inadequate error handling
   - `type-design-analyzer` — type invariants, encapsulation, enforcement

2. **Fallback path (plugin not available):** If the agents aren't available, perform the review inline covering the same three lenses (bugs/security/performance, silent failures, type design quality).

3. **Partial availability:** If only some agents are available, use available agents and fall back to inline analysis for the missing lenses.

The only shared constraint across both paths is the JSON output format, which is already injected by the review executor — the prompt itself doesn't need to specify it.

## What Doesn't Change

- `src/built-in-reviews/index.ts` — no changes
- `src/config/` — no schema or loader changes
- `src/gates/review.ts` — no executor changes
- `.gauntlet/reviews/code-quality.yml` — still references `builtin: code-quality`
- JSON violation output format — still controlled by the review executor

## Approach

Conditional instruction in the prompt (Approach A). Claude detects plugin availability at runtime. No new config fields, no new built-in names, no code changes beyond the markdown file.

## Agent Selection Rationale

- **code-reviewer:** Core review lens — bugs, security, logic errors
- **silent-failure-hunter:** Catches swallowed errors and missing logging that the previous prompt under-weighted
- **type-design-analyzer:** Evaluates type invariants and encapsulation — valuable for TypeScript codebases
- **Skipped pr-test-analyzer:** Test coverage is better handled by static tooling
- **Skipped comment-analyzer:** Low signal, high false-positive risk
- **Skipped code-simplifier:** "You could simplify this" is non-blocking feedback
