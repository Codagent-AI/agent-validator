## Why

Gate configs (checks and reviews) currently require separate files in `.validator/checks/` and `.validator/reviews/`. For most projects, each check file contains only a `command` plus a few non-default attributes, and the default `code-quality.yml` review is a one-liner. Top-level `checks` and `reviews` maps in `config.yml` let users define their gates inline, reducing file count and keeping configuration in one place.

## What Changes

- Add a top-level `checks` map in `config.yml` where each key is a check name and the value is the check config object (same schema as `.validator/checks/*.yml` files).
- Add a top-level `reviews` map in `config.yml` where each key is a review name and the value is the review config object (same schema as `.validator/reviews/*.yml` files).
- Entry points continue to reference checks and reviews by name — no change to `entry_points` syntax.
- File-based checks and reviews remain fully supported for backwards compatibility.
- If a name is defined both inline and as a file, the system rejects with a validation error.
- `init` writes `code-quality` inline in `config.yml` instead of creating `.validator/reviews/code-quality.yml`; stops creating the `.validator/checks/` and `.validator/reviews/` directories.
- `validator-setup` writes checks inline in `config.yml` instead of creating separate `.validator/checks/*.yml` files.
- Docs and examples are updated to show inline style as the preferred approach.

## Capabilities

### New Capabilities
- `inline-check-config`: Defining check gate configurations as a top-level `checks` map directly in `config.yml`, eliminating the need for separate per-check YAML files.
- `inline-review-config`: Defining review gate configurations as a top-level `reviews` map directly in `config.yml`, eliminating the need for separate per-review YAML files.

### Modified Capabilities
- `check-config`: Extend to cover inline check definitions alongside the existing file-based approach; name collision = error.
- `review-config`: Extend to cover inline review definitions alongside the existing file-based approach; name collision = error.
- `init-config`: Init writes code-quality inline in `config.yml`; stops creating `.validator/checks/` and `.validator/reviews/` directories.

## Impact

- `src/config/schema.ts` — add optional top-level `checks` and `reviews` maps to config schema
- `src/config/` (config loading) — merge inline + file-based for both checks and reviews; error on name collision
- `src/commands/init.ts` — write code-quality inline; stop creating `checks/` and `reviews/` directories
- `validator-setup` skill — write checks inline in `config.yml` instead of separate files; remove code-quality setup (handled by init)
- `docs/config-reference.md` — document inline `checks` and `reviews` sections; mark file-per-gate as "also supported"
- `docs/user-guide.md` — update getting-started examples
- `.gauntlet/config.yml` — migrate this project's own checks and code-quality review to inline
- `.gauntlet/checks/*.yml` — delete all (9 files)
- `.gauntlet/reviews/code-quality.yml` — delete (moved inline)
