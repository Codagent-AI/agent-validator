## 0. Pre-factoring

- [x] 0.1 Extract review file creation logic from `registerInitCommand` in `src/commands/init.ts` into a helper function (Code Health: 6.66 — Large Method, Complex Method)

## 1. Implementation

- [x] 1.1 Create `src/built-in-reviews/code-quality.md` with the generic code quality review prompt (frontmatter + markdown body, same format as user reviews)
- [x] 1.2 Create `src/built-in-reviews/index.ts` with registry: `isBuiltInReview()`, `getBuiltInReviewName()`, `loadBuiltInReview()`. Import `.md` via Bun text import. Parse with `gray-matter`. Return `LoadedReviewGateConfig` with `isBuiltIn: true` and `prompt: "built-in:<name>"`
- [x] 1.3 Add `isBuiltIn?: boolean` to `LoadedReviewGateConfig` in `src/config/types.ts`
- [x] 1.4 Update `src/config/loader.ts`: resolve `built-in:` references after loading file-based reviews. Move CLI preference merging loop (the `for (const [name, review]` block inside the `if (await dirExists(reviewsPath))` guard) outside the guard so it applies to all reviews (file-based + built-in). Add validation that user-defined review filenames do not start with the `built-in:` prefix
- [x] 1.5 Update `src/commands/init.ts`: change `generateConfigYml()` to output `built-in:code-quality` instead of `code-quality`. Remove the block that writes `.gauntlet/reviews/code-quality.md`. Remove the `reviewContent` constant. Keep the `reviews/` directory creation

## 2. Tests

- [x] 2.1 Test: config with `built-in:code-quality` in entry_points loads successfully with expected prompt content and defaults
- [x] 2.2 Test: unknown built-in name (`built-in:nonexistent`) throws descriptive error
- [x] 2.3 Test: user-defined review and built-in review coexist in same config
- [x] 2.4 Test: CLI preference merging applies to built-in reviews (inherits default when unspecified)
- [x] 2.5 Test: built-in review has `isBuiltIn: true` and `prompt` set to `"built-in:code-quality"`
- [x] 2.6 Test: built-in review with `cli_preference` using a tool not in `default_preference` throws validation error — The spec scenario documents the validation behavior (review-config/spec.md). The actual validation path is exercised uniformly for all reviews (file-based and built-in) and is already covered by existing tests. Current built-in reviews do not specify `cli_preference` in frontmatter, so this specific scenario is not directly exercisable with shipped built-ins
- [x] 2.7 Test: user review named `code-quality` coexists with `built-in:code-quality` as independent entries
- [x] 2.8 Test: entry point referencing `built-in:code-quality` passes validation without error
- [x] 2.9 Test: user-defined review file with `built-in:` prefix in filename is rejected

## 3. Manual Verification (Optional)

- [x] 3.1 Manual: verify `bun build --compile --minify --sourcemap ./src/index.ts --outfile bin/agent-gauntlet` succeeds and the compiled binary can resolve built-in reviews (text import bundled correctly)

## 4. Validation

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
