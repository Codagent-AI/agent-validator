## Context

Check gate configuration currently requires a `.validator/checks/<name>.yml` file for every check. For most projects, each file contains only `command` plus a few attributes (primarily `parallel: true`). With 8–10 checks typical for a medium project, this creates 8–10 nearly-identical boilerplate files. Similarly, review gate configuration requires a `.validator/reviews/<name>.yml` (or `.md`) file — the default `code-quality` review created by `init` is a single-line YAML file. The `config.yml` already contains all structural config; it's the natural place to define simple checks and reviews inline.

## Goals / Non-Goals

**Goals:**
- Allow defining checks as a top-level `checks` map in `config.yml`
- Allow defining reviews as a top-level `reviews` map in `config.yml`
- Keep the same gate attribute schemas (no new attributes needed for either checks or reviews)
- Omit attributes that equal their default value to minimize config noise
- Preserve full backwards compatibility — file-based checks and reviews continue to work
- Migrate this project's own `.gauntlet/checks/*.yml` and `.gauntlet/reviews/code-quality.yml` to inline
- Update docs and examples to prefer inline style

**Non-Goals:**
- Automatically migrating existing projects (no migration tooling)
- Changing entry_point syntax — gates are still referenced by name string
- Inline definitions within `entry_points` items (avoids duplication when a gate is shared across entry points)

## Decisions

### 1. Top-level `checks` and `reviews` maps, not lists

Inline gates live under top-level `checks` and `reviews` keys as YAML maps (gate name → config object):

```yaml
checks:
  build:
    command: bun run build
    parallel: true
  lint:
    command: bunx biome check src
    parallel: true
    timeout: 60

reviews:
  code-quality:
    builtin: code-quality
    num_reviews: 1
```

**Why map over list:** Named entities are naturally a map. A list of single-key objects adds noise and makes lookups awkward. Entry points already reference gates by name string — a map mirrors that cleanly.

### 2. Conflict resolution: error, not precedence

If a gate name appears both inline in `config.yml` and as a file in the corresponding directory (`.validator/checks/` for checks, `.validator/reviews/` for reviews), the system rejects config loading with a clear error naming the conflicting gate.

This applies identically to both checks and reviews.

**Why error over "inline wins" or "file wins":** Silent override leads to confusion about which definition is active. An explicit error forces the user to resolve the ambiguity and keeps configuration unambiguous.

### 3. `working_directory: .` omission

For this project all checks set `working_directory: .`, which is redundant when the entry point path is also `"."`. When `working_directory` is omitted, the existing behavior (run in entry point directory) applies. Users can still set it explicitly for checks that need a different directory.

### 4. Schema changes: optional top-level `checks` and `reviews` maps

The config Zod schema gains two optional fields:

- `checks`: `z.record(z.string(), checkGateSchema).optional()` — same schema as `.validator/checks/*.yml` files.
- `reviews`: `z.record(z.string(), reviewGateSchema).optional()` — same schema as `.validator/reviews/*.yml` files (one of `builtin`/`prompt_file`/`skill_name` plus optional attributes).

The loader merges each map with its file-based counterpart after both are loaded. The gate schemas themselves are unchanged — the same attributes, defaults, and validation rules apply.

### 5. This project's gate migration

All 9 checks in `.gauntlet/checks/` and the `code-quality` review in `.gauntlet/reviews/` move inline. The minimal non-default attributes for each:

**Checks:**

| Check | Kept attributes |
|---|---|
| build | `command`, `parallel: true` |
| lint | `command`, `parallel: true`, `timeout: 60` |
| test | `command`, `parallel: true` |
| typecheck | `command`, `parallel: true`, `timeout: 60` |
| security-code | `command`, `parallel: true`, `timeout: 180` |
| security-deps | `command`, `parallel: true`, `timeout: 120` |
| schema-validate | `command`, `parallel: true` |
| openspec-validate | `command`, `parallel: true`, `run_in_ci: false` |
| no-orphaned-design-docs | `command`, `parallel: true` |

Attributes omitted (all equal their defaults): `run_in_ci: true`, `run_locally: true`, `working_directory: .`.

**Reviews:**

| Review | Kept attributes |
|---|---|
| code-quality | `builtin: code-quality`, `num_reviews: 1` |

The `code-quality` review is a single-line config referencing a built-in prompt — a natural fit for inline definition.

### 6. Init and validator-setup generate inline configs

`agent-validate init` writes the `code-quality` review inline in `config.yml` under the `reviews` map instead of creating `.validator/reviews/code-quality.yml`. It no longer creates the `.validator/checks/` or `.validator/reviews/` directories.

`validator-setup` writes discovered checks inline in `config.yml` under the `checks` map rather than creating `.validator/checks/*.yml` files.

Existing file-based gates are not touched on re-run.

## Risks / Trade-offs

- **Large gate sets become verbose in config.yml** → For projects with many checks or reviews, separate files may still be preferable. Both styles are supported; this is a preference, not a mandate.
- **Reviews with long prompts don't belong inline** → Reviews using `prompt_file` with large prompt content are better as separate files. Inline reviews work best for simple configs (`builtin` or short `prompt_file` references). The inline option doesn't change what's possible — it just adds a more convenient path for simple cases.
- **Schema versioning** → Adding optional top-level keys is non-breaking for existing configs; parsers that ignore unknown keys are unaffected. Strict schema validation may surface warnings for older tooling — mitigated by the optional nature of the fields.

## Migration Plan

1. Update config schema to add optional top-level `checks` and `reviews` maps.
2. Update config loader to merge inline + file-based gates for both checks and reviews; error on collision.
3. Update `init` to write `code-quality` review inline; stop creating `.validator/checks/` and `.validator/reviews/` directories.
4. Update `validator-setup` to write checks inline in `config.yml`.
5. Migrate `.gauntlet/checks/*.yml` and `.gauntlet/reviews/code-quality.yml` in this project to inline in `.gauntlet/config.yml`, then delete the files.
6. Update `docs/config-reference.md` to document inline `checks` and `reviews` maps; mark file-per-gate as "also supported".
7. Update `docs/user-guide.md` examples.
8. Update any spec examples that show file-based gate config.

Rollback: revert the schema and loader changes; re-add deleted gate files from git history. Existing projects using file-based gates are unaffected by the schema additions.
