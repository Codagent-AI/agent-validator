## Context

The built-in code-quality review prompt depends on external pr-review-toolkit agents with an inline fallback pattern, adding complexity for no benefit. Research (SWR-Bench, CodeX-Verify, Meta semi-formal reasoning) identifies techniques that improve review quality: structured reasoning formats, specialized reviewers, and recall-oriented thresholds. The current prompt uses none of these.

## Goals / Non-Goals

**Goals:**
- Remove pr-review-toolkit dependency; make all prompts fully self-contained
- Apply research-backed structured reasoning formats to each prompt
- Prioritize recall over precision — the downstream AI fixer cheaply skips false positives, but missed real issues are costly
- Add optional specialized reviewers (security, error-handling) that users can enable via init or config
- Keep the init experience simple with sensible defaults (all three built-ins enabled)

**Non-Goals:**
- Aggregation/synthesis pass across multiple reviewers (programmatic dedup in review-agg.ts is sufficient)
- Few-shot examples in prompts (would bloat prompt size; may revisit after eval)
- Changes to review execution, evaluation, or JSON output format

## Approach

### Prompt Architecture

Each built-in review prompt is a self-contained markdown file with four sections: reasoning format, categories, exclusions, and guidelines. Each prompt uses a domain-specific reasoning format that structures the model's analysis without gating its output.

**Shared design principle:** All reviewers prioritize recall over precision. When uncertain, report the issue. Exclusion lists are limited to pure noise (style, formatting, docs, code outside diff) — not to "hypothetical" or "unlikely" issues which may still be real.

### code-quality.md (rewritten)

**Reasoning format — 3-step execution trace (soft):**
For each issue, the reviewer structures its finding as: (1) state the precondition that triggers the problem, (2) trace the execution path through the changed code, (3) identify the specific failure. This is an output format guide, not a hard gate — if a step is uncertain, the reviewer still reports the issue.

**Categories:** Logic errors (off-by-one, null/undefined, race conditions, unhandled edge cases), performance (algorithmic complexity, N+1 queries, blocking operations, memory leaks), resource leaks (unclosed handles, missing cleanup in error paths), type safety (types permitting invalid states, missing boundary validation).

**Exclusions (noise only):** Style/formatting/naming, documentation/comments/type annotations, code not changed in the diff.

**Threshold:** "Could cause a bug, performance issue, or silent failure in production."

### security.md (new)

**Reasoning format — taint-flow trace:**
For each issue: (1) identify the untrusted source (user input, external API, environment variable, etc.), (2) trace the data flow from source to sink, (3) describe the exploit scenario.

**Categories:** Injection (SQL, command, path traversal, XSS), authentication/authorization gaps, secrets and credential exposure, input validation failures, unsafe deserialization, SSRF.

**Exclusions (noise only):** Style preferences for security patterns, code not changed in the diff.

**Threshold:** "Could be exploited or expose sensitive data."

### error-handling.md (new)

**Reasoning format — counterfactual analysis:**
For each issue: (1) identify what can fail (network call, file I/O, parse operation, etc.), (2) trace what happens when it does fail, (3) show the gap (lost context, silent swallow, missing observability).

**Categories:** Swallowed errors (empty catch blocks, catch-and-return-default, ignored promise rejections), lost error context (re-throwing without cause chain, generic error messages), missing observability (error paths with no logging), unsafe fallbacks (fallback values that mask bugs rather than fail visibly).

**Exclusions (noise only):** Error handling in test code, logging style preferences, code not changed in the diff.

**Threshold:** "Could cause a silent failure or make debugging harder in production."

### Built-in Registry Changes

`src/built-in-reviews/index.ts` adds two new entries to `builtInSources`:
- `'security'` → content of `security.md`
- `'error-handling'` → content of `error-handling.md`

No changes to the `isBuiltInReview` or `loadBuiltInReview` functions — they already work with any key in the map.

### Init Command Changes

**New prompt in Phase 3** (after review CLI selection and num_reviews):
- Multi-select showing all available built-in reviews: `code-quality`, `security`, `error-handling`
- All three pre-selected by default; user deselects to opt out
- Selected reviews are written inline to `config.yml` under the `reviews` map, each with `builtin: <name>` and the configured `num_reviews`

**`--yes` behavior:** Selects all three built-in reviews without prompting.

**Implementation:** Add `promptBuiltInReviews()` to `init-prompts.ts` using `@inquirer/prompts` `checkbox` (same pattern as `promptDevCLIs`). Update `writeConfigYml()` to accept the list of selected built-in names and generate a review entry for each.

## Decisions

| Decision | Rationale |
|----------|-----------|
| Soft reasoning format, not hard gate | Prioritize recall. Structured reasoning guides quality without suppressing uncertain-but-real findings. |
| Domain-specific reasoning per prompt | Taint-flow fits security better than generic execution trace. Counterfactual fits error-handling. Each format matches how experts actually review that category. |
| Noise-only exclusions | Loosened from "hypothetical issues" exclusion. With recall prioritized and AI fixing downstream, only pure noise (style, docs, out-of-diff) is excluded. |
| All three built-ins enabled by default in init | Users get thorough reviews out of the box. Easy to opt out by deselecting during init. |
| No aggregation/synthesis pass | Programmatic dedup in review-agg.ts is sufficient. Avoids burning another LLM call. May revisit if duplicate findings become noisy. |

## Risks / Trade-offs

- **More findings to triage:** Recall-first means more reported issues per review. Mitigated by the AI fixer skipping false positives cheaply.
- **Three reviews cost 3x the LLM calls:** Users opting into all three built-ins will use more tokens/time. Mitigated by making it opt-out (user sees the cost upfront during init) and by the existing `parallel: true` support.
- **Prompt size:** Each prompt is independent with its own exclusions. Some duplication, but keeps each prompt self-contained and independently tuneable.

## Open Questions

None — all design decisions resolved during conversation.
