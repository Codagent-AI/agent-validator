# Change: Update built-in code-quality prompt to leverage pr-review-toolkit

## Why
The current built-in code-quality prompt is a generic "find bugs" instruction. When the reviewing CLI has access to pr-review-toolkit agents (code-reviewer, silent-failure-hunter, type-design-analyzer), the prompt should leverage them for deeper, multi-lens analysis. When the plugin is unavailable, the prompt should fall back to an equivalent inline framework covering the same three lenses.

## What Changes
- Replace the content of `src/built-in-reviews/code-quality.md` with a two-path prompt:
  1. **Primary path**: Instruct the reviewer to dispatch three pr-review-toolkit agents (code-reviewer, silent-failure-hunter, type-design-analyzer) and merge their findings
  2. **Fallback path**: Perform the same three-lens review inline when the agents are unavailable
- No code changes to `src/built-in-reviews/index.ts`, `src/gates/review.ts`, config schemas, or the `.gauntlet/reviews/code-quality.yml` reference

## Alternatives Considered
- **Improve the existing prompt without plugin dependency**: Expanding the current generic prompt to cover silent failures and type design inline. Viable but misses the deeper analysis that dedicated agents provide when available.
- **Add pr-review-toolkit as a separate built-in review**: Creating a new `builtin: pr-review-toolkit` alongside `builtin: code-quality`. Rejected because it would require users to update their config and the two reviews would overlap significantly in scope.
- **Make review lenses configurable in YAML**: Adding a `lenses` field to review config. Over-engineered for the current need — the lenses are tightly coupled to the prompt content, not independent config.

The chosen approach (conditional prompt) is preferred because it requires zero config changes, zero code changes, and gracefully degrades.

## Impact
- Affected specs: `review-config` (modifies the "Built-in code-quality prompt content" scenario)
- Affected code: `src/built-in-reviews/code-quality.md` (content only, no structural changes)
