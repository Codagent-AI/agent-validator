## 0. Pre-factoring

`src/commands/init.ts` (Code Health: 6.39) is a hotspot with Complex Method, Large Method, and Bumpy Road smells. Pre-factoring deferred: this change adds a constant and a single `writeFile` call to `registerInitCommand`, plus changes one string in `generateConfigYml`. These modifications do not increase the file's complexity score. A targeted refactoring of `registerInitCommand` is warranted but out of scope for this change.

All other affected files score above the threshold:
- `src/built-in-reviews/index.ts` — 10.0
- `src/config/schema.ts` — 10.0
- `src/config/loader.ts` — 10.0
- `src/config/types.ts` — type-only file (no score)
- `test/config/loader.test.ts` — 10.0

## 0.5 Prerequisites

- [ ] 0.5.1 Archive the `add-built-in-reviews` change (`openspec archive add-built-in-reviews --yes`) so REMOVED/MODIFIED spec deltas reference existing canonical spec requirements. *(Run before applying spec deltas, not during implementation.)*

## 1. Implementation

- [x] 1.1 Update `src/built-in-reviews/code-quality.md`: remove frontmatter, rewrite prompt to match `.gauntlet/reviews/code-quality.md` but without the Documentation focus area. Keep: Bugs, Security, Performance, Maintainability. Include the "Do NOT Report" and "Guidelines" sections.
- [x] 1.2 Simplify `src/built-in-reviews/index.ts`: remove `gray-matter` and schema imports, `loadBuiltInReview()` returns raw markdown string (not `LoadedReviewGateConfig`). Remove `getBuiltInReviewName()`. Keep `isBuiltInReview()` as a filename validation guard only — it rejects user-defined review files starting with the reserved `built-in:` prefix but is no longer used for loading built-in reviews.
- [x] 1.3 Update `src/config/schema.ts`: add `builtin: z.string().optional()` to `reviewYamlSchema`. Update refinements so `builtin`, `prompt_file`, and `skill_name` are mutually exclusive, and exactly one of the three must be specified.
- [x] 1.4 Update `src/config/loader.ts`:
  - In the YAML review loading block, handle `builtin` attribute: call a simplified built-in loader to get prompt content.
  - Remove the "3b. Load built-in reviews referenced by entry points" section.
  - Keep the `isBuiltInReview()` prefix validation for user review filenames (rejects files named `built-in:*`).
  - CLI preference merging should remain outside the `dirExists` guard so it applies to all reviews loaded from files.
- [x] 1.5 Update `src/config/types.ts`: remove `isBuiltIn?: boolean` from `LoadedReviewGateConfig`.
- [x] 1.6 Update `src/commands/init.ts`:
  - Add a constant for the default review YAML content (`builtin: code-quality\nnum_reviews: 2`)
  - Write `.gauntlet/reviews/code-quality.yml` during init
  - Update `generateConfigYml()` to reference `code-quality` instead of `built-in:code-quality` in entry point reviews

## 2. Tests

- [x] 2.1 Test: YAML review with `builtin: code-quality` loads successfully with prompt content and configured settings
- [x] 2.2 Test: YAML review with unknown `builtin` name throws descriptive error
- [x] 2.3 Test: YAML review with both `builtin` and `prompt_file` is rejected
- [x] 2.4 Test: YAML review with both `builtin` and `skill_name` is rejected
- [x] 2.5 Test: YAML review with `builtin` and no other settings uses schema defaults (num_reviews: 1, parallel: true, run_in_ci: true, run_locally: true)
- [x] 2.6 Test: user-defined `.md` review and YAML `builtin` review coexist
- [x] 2.7 Test: CLI preference merging applies to YAML builtin reviews
- [x] 2.8 Test: `init` generates `.gauntlet/reviews/code-quality.yml` with builtin reference
- [x] 2.9 Test: `init` config.yml references `code-quality` (not `built-in:code-quality`)
- [x] 2.10 Test: update existing built-in review tests to match new behavior (remove tests for `built-in:` prefix in entry points, `isBuiltIn` flag, etc.)
- [x] 2.11 Test: user-defined review file with `built-in:` prefix in filename is still rejected
- [x] 2.12 Test: built-in code-quality prompt is pure markdown (no frontmatter), includes Bugs/Security/Performance/Maintainability focus areas, and does not contain Documentation references

## 3. Validation

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
