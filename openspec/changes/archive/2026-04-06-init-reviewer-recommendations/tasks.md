## 1. Add recommendation logic

- [x] 1.1 Add `ReviewEntry` and `ReviewConfig` types and `selectReviewConfig()` pure function in `init.ts`
- [x] 1.2 Add `printReviewConfigExplanation()` function in `init.ts`

## 2. Update init flow

- [x] 2.1 Remove `promptBuiltInReviews()` call from `runInit()` and replace with `selectReviewConfig()` + `printReviewConfigExplanation()`
- [x] 2.2 Update `scaffoldValidatorDir()` and `writeConfigYml()` signatures to accept `ReviewConfig` instead of `selectedBuiltIns`
- [x] 2.3 Update `writeConfigYml()` to emit review entries with `builtin`, `cli_preference`, and `model` from `ReviewConfig`
- [x] 2.4 Reorder `CLI_PREFERENCE_ORDER` to put `github-copilot` first

## 3. Clean up prompts

- [x] 3.1 Delete `promptBuiltInReviews()` from `init-prompts.ts` and remove `getBuiltInReviewNames` import
- [x] 3.2 Remove `promptBuiltInReviews` from the import list in `init.ts`

## 4. Tests

- [x] 4.1 Add unit tests for `selectReviewConfig()` covering primary, secondary, and fallback paths
- [x] 4.2 Update any existing init tests that reference `promptBuiltInReviews` or `selectedBuiltIns`
