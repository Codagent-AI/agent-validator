## Context
The config loader (`src/config/loader.ts`) currently loads all reviews from the `.gauntlet/reviews/` directory. The `init` command creates a default `code-quality.md` file there. This change introduces package-bundled reviews that can be referenced via a `built-in:<name>` prefix, so projects get maintained review prompts without creating files.

The `init.ts` file (Code Health: 6.66) is a hotspot that will be modified. Pre-factoring is documented below.

## Goals / Non-Goals
- Goals:
  - Ship a curated `code-quality` review prompt with the package
  - Allow `config.yml` to reference built-in reviews via `built-in:<name>` syntax
  - Simplify `init` by referencing built-in reviews instead of creating review files
  - Ensure built-in reviews participate in CLI preference merging and all downstream flows
- Non-Goals:
  - User-extensible built-in review plugins
  - Versioning or upgrade-path for built-in reviews (they track the package version)
  - Removing support for file-based reviews

## Decisions

### Built-in review storage: Bun text imports
- **Decision**: Store built-in review prompts as `.md` files in `src/built-in-reviews/` and import them using Bun's text import (`import content from "./file.md" with { type: "text" }`).
- **Alternatives considered**:
  - Template literal strings in TypeScript — simpler but harder to author/maintain as markdown
  - `fs.readFileSync` with `import.meta.dir` — works but couples to filesystem at runtime, problematic for compiled binaries
- **Rationale**: Text imports are bundled at build time by `bun build --compile`, keeping the review content embedded in the binary. The `.md` format is consistent with user-authored reviews and can be parsed identically with `gray-matter`.

### Registry keying: full `built-in:<name>` string
- **Decision**: Store built-in reviews in the `reviews` record under the full key `built-in:code-quality`, not just `code-quality`.
- **Rationale**: Prevents collisions with user-defined reviews of the same name. Downstream consumers (JobGenerator, ReviewGateExecutor) use the exact entry_point review name for lookups, so no changes needed.

### CLI preference merging: restructure loop placement
- **Decision**: Move the CLI preference merging loop (the `for (const [name, review]` block inside the `if (await dirExists(reviewsPath))` guard in `loader.ts`) outside the guard so it runs over all reviews including built-ins.
- **Rationale**: Currently the merge loop only runs when the reviews directory exists. Built-in reviews are injected after that block, so they would be skipped. Moving the loop to run after all reviews (file-based + built-in) are collected ensures consistent behavior.

### `prompt` field value for built-ins
- **Decision**: Set the `prompt` field on built-in `LoadedReviewGateConfig` to `"built-in:<name>"` (e.g., `"built-in:code-quality"`).
- **Rationale**: The `prompt` field serves as a source identifier for logging/display. Using the full built-in reference string makes it clear the review came from the package, not a filesystem file.

## Pre-factoring

### `src/commands/init.ts` (Code Health: 6.66)
Code smells identified:
- **Bumpy Road**: `promptAndInstallCommands` (3 bumps), `promptForConfig` (2 bumps), `installCommands` (2 bumps)
- **Complex Method**: `promptAndInstallCommands` (cc=24), `promptForConfig` (cc=18)
- **Large Method**: `registerInitCommand` (168 LoC), `promptAndInstallCommands` (158 LoC), `promptForConfig` (99 LoC)

**Refactoring strategy**: The change to `init.ts` is minimal (remove the review file write, update `generateConfigYml` to use `built-in:code-quality`). Pre-factoring the entire file is out of scope for this change. However, extracting the review file creation logic into a small helper would reduce `registerInitCommand` length and make the built-in change cleaner. Scope pre-factoring to the specific code being modified rather than full file refactoring.

### Other files
- `src/config/loader.ts` (Code Health: 10.0) — No pre-factoring needed.
- `src/config/types.ts` — Type-only file, no code health score. No pre-factoring needed.
- `test/config/loader.test.ts` (Code Health: 10.0) — No pre-factoring needed.

## Risks / Trade-offs
- **Bun text import in compiled binary**: Must verify `bun build --compile` correctly bundles `.md` text imports. Mitigation: test early in implementation; fall back to string constant if needed.
- **No migration for existing projects**: Projects created with `init` before this change still have file-based `code-quality`. This is fine — they continue to work. No forced migration needed.

## Open Questions
- None — design decisions are straightforward given the codebase conventions.
