# Change: Add built-in review support

## Why
Reviews are loaded exclusively from `.gauntlet/reviews/`, meaning every project must create its own review files. The `init` command generates a generic `code-quality.md` template, but it's a one-time copy that can't be maintained or updated by the package. Built-in reviews let the package ship curated review prompts that any project can reference without creating files.

## What Changes
- New `built-in:` prefix syntax in `config.yml` review references (e.g., `built-in:code-quality`)
- New `src/built-in-reviews/` module containing bundled review prompts and a registry
- Config loader resolves `built-in:` references from the package instead of the filesystem
- `init` command references `built-in:code-quality` instead of creating `.gauntlet/reviews/code-quality.md`
- CLI preference merging applies to built-in reviews (requires restructuring the merge loop in `loader.ts`)

## Impact
- Affected specs: `review-config` (ADDED — built-in prefix syntax, code-quality review content, reserved prefix validation), `init-hook-install` (ADDED — new scenario for built-in review reference; existing requirements unchanged)
- Affected code:
  - `src/built-in-reviews/index.ts` (new)
  - `src/built-in-reviews/code-quality.md` (new)
  - `src/config/loader.ts` — resolve built-in references, restructure CLI preference merging
  - `src/config/types.ts` — add `isBuiltIn` flag
  - `src/commands/init.ts` — reference built-in review instead of creating file
  - `test/config/loader.test.ts` — new test cases
