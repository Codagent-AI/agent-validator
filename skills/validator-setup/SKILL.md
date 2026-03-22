---
name: validator-setup
description: Scans the project and configures checks and reviews for Agent Validator. Use when asked to "set up validator", "configure checks and reviews", or "initialize validator for this repo".
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# /validator-setup

Scan the project to discover tooling and configure checks and reviews for agent-validator.

Before starting, read `references/check-catalog.md` for check category details, YAML schemas, and example configurations.

## Step 1: Check config exists

Read `.validator/config.yml`. If the file does not exist, tell the user to run `agent-validate init` first and **STOP** — do not proceed with any further steps.

## Step 2: Check existing config

Read the `entry_points` field from `.validator/config.yml`.

**If `entry_points` is empty (`[]`):** This is a fresh setup. Proceed to Step 3 (detect project structure).

**If `entry_points` is populated:** Show the user a summary of the current configuration:
- List each entry point with its `path`, `checks`, and `reviews`
- Then ask the user which action to take:

  1. **Add checks** — Scan for tools not already configured. Proceed to Step 3, but filter out any checks that already appear in `entry_points`.
  2. **Add custom** — User describes what they want to add. Skip to Step 7.
  3. **Reconfigure** — Start fresh. Back up existing files first:
     - Rename each `.validator/checks/*.yml` file to `.yml.bak` (overwrite any previous `.bak` files)
     - Rename each custom `.validator/reviews/*.md` file to `.md.bak` (overwrite any previous `.bak` files)
     - Do NOT rename `.validator/reviews/*.yml` files (these are built-in review configs)
     - Clear `entry_points` to `[]` in `config.yml`
     - Proceed to Step 3

## Step 3: Detect project structure

Scan for signals to classify the project as **monorepo**, **split project**, or **single project**.

### Monorepo signals

- `package.json` with a `workspaces` field
- `pnpm-workspace.yaml`
- `lerna.json`, `nx.json`, `turbo.json`
- `Cargo.toml` with a `[workspace]` section
- Multiple subdirectories under `packages/`, `apps/`, or `services/` each containing their own project manifest (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`)

### Split project signals

- `frontend/` + `backend/` (or `client/` + `server/`, `web/` + `api/`) directories each containing source code and/or their own project manifest
- Multiple apps or libraries of the same language under a common parent directory (e.g., `apps/web/`, `apps/api/`, `apps/worker/` each with their own source and config) — suggests a wildcard entry point like `apps/*`

### Single project signals

- `src/` or `lib/` as sole source directory, or source files at project root
- No monorepo or split project signals found

**If monorepo or split project:** Read `references/project-structure.md` for detailed multi-project entry point guidance, then follow it for Steps 4 through 8. The rest of this file covers the single-project flow.

**If single project:** Tell the user what you detected and continue below.

## Step 4: Determine entry point path

Infer the source directory:
- If `src/` exists and contains source code, suggest `src`
- If `lib/` exists and contains source code, suggest `lib`
- Otherwise suggest `.` (project root — safer default since it captures all changes)

**Skip this step** if adding checks to an existing entry point that already has a path.

## Step 5: Scan for tooling

Scan the project for tooling signals across the 6 check categories listed in `references/check-catalog.md`.

**For the "add checks" path:** Filter out checks already configured in `entry_points`.

**If no tools discovered:** Offer the custom flow (skip to Step 7). Still include `code-quality` review.

## Step 6: Present findings and confirm

Show a table of discovered checks:

```
Category        | Tool            | Command                              | Confidence
----------------|-----------------|--------------------------------------|-----------
Build           | npm             | npm run build                        | High
Lint            | ESLint          | npx eslint .                         | High
Typecheck       | TypeScript      | npx tsc --noEmit                     | High
Test            | Jest            | npx jest                             | High
Security (deps) | npm audit       | npm audit --audit-level=moderate     | Medium
Security (code) | Semgrep         | semgrep scan --config auto --error . | Medium
```

**Confidence levels:**
- **High** — Tool config file found AND/OR explicit script in package.json/Makefile
- **Medium** — Tool found in devDependencies or inferred from CI workflow but no dedicated config
- **Low** — Only indirect evidence (e.g., test directory exists but no runner config found)

If a category has no discovered tool, show `(not found)` with `—` for command and confidence.

Ask the user:
1. Which checks to enable (default: all)
2. Whether any commands need adjustment

If the user declines ALL checks, still include `code-quality` review and offer the custom flow (Step 7).

After confirmation, proceed to Step 8 (create files).

## Step 7: Add custom

Ask the user: **check** (shell command) or **review** (AI code review)?

**For checks:** Ask for command, name, and optional settings (timeout, parallel, run_in_ci, run_locally).

**For reviews:** Built-in (`code-quality`) or custom prompt? Ask for name and write the review content.

## Step 8: Create files and update config

**Checks** — Create `.validator/checks/<name>.yml` with `command`, `parallel: true`, `run_in_ci: true`, `run_locally: true`. Add optional fields only when specified. See `references/check-catalog.md` for schema.

**Custom reviews** — Create `.validator/reviews/<name>.md` with YAML frontmatter (`num_reviews: 1`) and review prompt.

**Built-in reviews** — Create `.validator/reviews/<name>.yml` with `builtin: code-quality` and `num_reviews: 1`.

**Update entry_points** in `.validator/config.yml`:

```yaml
entry_points:
  - path: "<source_dir>"
    checks:
      - <check-name-1>
      - <check-name-2>
    reviews:
      - code-quality
```

Always include `code-quality` in `reviews` for fresh setups. For "add checks" / "add custom": append to the appropriate entry point's lists, or add a new entry point if needed.

## Step 9: "Add something else?"

Ask the user. If yes, loop to Step 7. If no, proceed.

## Step 10: Validate

Run `agent-validate validate`. If it fails, apply one corrective attempt and re-validate. If it still fails, **STOP** and ask the user.

## Step 11: Commit configuration

Commit all validator configuration and skills so the setup is preserved in version control:

1. Stage all new/modified files: `.validator/`, `.claude/skills/validator-*/`, `.claude/settings.local.json`, `.gitignore`
2. Create a commit: `git commit -m "chore: configure agent-validator checks and reviews"`

If there are no changes to commit (everything already committed), skip this step silently.

## Step 12: Suggest next steps

Tell the user: configuration is complete. Run `/validator-run` to execute, or `/validator-setup` again to add more.
