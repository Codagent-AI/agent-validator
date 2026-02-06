## Context
The `add-built-in-reviews` change introduced built-in reviews using Bun text imports with frontmatter-bearing markdown files and a `built-in:` prefix syntax in `config.yml` entry points. This refactor simplifies the approach: built-in prompts are pure markdown, YAML review configs gain a `builtin` attribute, and `init` generates a visible YAML review file.

This change supersedes `add-built-in-reviews`. That change should be archived before this one is applied.

## Goals / Non-Goals
- Goals:
  - Built-in prompts are pure markdown (no frontmatter, no settings)
  - YAML review configs can reference built-in prompts via `builtin: <name>`
  - `init` generates `.gauntlet/reviews/code-quality.yml` with `builtin: code-quality` and default settings
  - Built-in code-quality prompt matches the project's existing review but without the Documentation section
  - Remove `built-in:` prefix syntax from entry points
- Non-Goals:
  - Supporting `builtin` in markdown frontmatter (only YAML review files)
  - Removing Bun text imports entirely (still used for bundling, just simplified)

## Decisions

### Built-in prompt format: pure markdown
- **Decision**: Built-in review `.md` files contain only the prompt text. No frontmatter.
- **Rationale**: Settings belong in the YAML review config file that references the built-in. This creates a clean separation: the built-in provides the prompt, the YAML config provides the settings. Users can inspect and customize settings by editing the YAML file.

### `builtin` attribute in YAML review schema
- **Decision**: Add `builtin` as a third option alongside `prompt_file` and `skill_name` in `reviewYamlSchema`. All three are mutually exclusive. YAML review files must specify exactly one.
- **Rationale**: Consistent with the existing pattern. The `builtin` attribute loads prompt content from the package instead of the filesystem.

### YAML review schema changes
- **Decision**: `reviewYamlSchema` refinement changes from "must have `prompt_file` or `skill_name`" to "must have exactly one of `prompt_file`, `skill_name`, or `builtin`".
- **Rationale**: Minimal schema change. The validation already enforces mutual exclusivity between `prompt_file` and `skill_name`; extending to include `builtin` is straightforward.

### `init` generates YAML review file
- **Decision**: `init` creates `.gauntlet/reviews/code-quality.yml` containing `builtin: code-quality` with default settings (`num_reviews: 2`). Config.yml references `code-quality` in entry point reviews.
- **Rationale**: Gives users a visible file they can inspect and customize. The YAML format makes the builtin reference and settings explicit.

### Remove `built-in:` prefix from entry points
- **Decision**: Remove the `isBuiltInReview()` check and `loadBuiltInReview()` call from the entry point resolution in `loader.ts`. Built-in reviews are now loaded through the normal YAML review file path.
- **Rationale**: The `built-in:` prefix was needed when built-ins were resolved directly from entry points. With YAML review configs as the intermediary, the prefix is unnecessary. Reviews are always resolved from `.gauntlet/reviews/` files.

### Registry simplification
- **Decision**: `loadBuiltInReview()` in `index.ts` returns just the prompt content string. No gray-matter parsing, no schema validation, no `LoadedReviewGateConfig` construction.
- **Rationale**: The registry's only job is to map a name to raw prompt content. All config parsing and validation happens in the loader when processing the YAML file.

### `isBuiltIn` field removal
- **Decision**: Remove the `isBuiltIn?: boolean` field from `LoadedReviewGateConfig`.
- **Rationale**: Reviews that use `builtin` are loaded through the normal YAML review path. They appear as regular file-based reviews with prompt content sourced from the package. There is no downstream need to distinguish them.

## Pre-factoring

Code Health scores for affected files:
- `src/commands/init.ts` — 6.39 (Complex Method, Large Method, Bumpy Road). Pre-factoring deferred: changes add a constant and a single `writeFile` call, which do not increase the file's complexity score. A targeted refactoring of `registerInitCommand` is warranted but out of scope for this change.
- `src/built-in-reviews/index.ts` — 10.0. No pre-factoring needed.
- `src/config/schema.ts` — 10.0. No pre-factoring needed.
- `src/config/loader.ts` — 10.0. No pre-factoring needed.
- `src/config/types.ts` — type-only file (no score). No pre-factoring needed.
- `test/config/loader.test.ts` — 10.0. No pre-factoring needed.

## Risks / Trade-offs
- **Breaking change for `built-in:` prefix users**: Projects using `built-in:code-quality` directly in `config.yml` entry points will break. Since this feature was just implemented and not yet released, there are no external users affected.
- **Migration for this project**: The project's own `.gauntlet/config.yml` may reference `built-in:code-quality` on the current branch. This will be updated as part of the change. The existing file-based `code-quality.md` review can coexist or be replaced by the YAML config.

## Migration Plan
- **No external migration needed**: The `built-in:` prefix feature has not been released. No external users are affected.
- **This project**: Update `.gauntlet/config.yml` to reference `code-quality` (file-based) instead of `built-in:code-quality`. Create `.gauntlet/reviews/code-quality.yml` with `builtin: code-quality` if switching from the file-based `.md` review.
- **Rollback**: Revert the code changes. Re-add the `built-in:` prefix handling to `loader.ts` and restore frontmatter to the built-in prompt.

## Open Questions
- None.
