---
name: gauntlet-setup
description: Scan project and configure checks and reviews
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# /gauntlet-setup

Scan the project to discover tooling and configure checks and reviews for agent-gauntlet.

Before starting, read the `references/check-catalog.md` file for check category details, YAML schemas, and example configurations.

## Step 1: Check config exists

Read `.gauntlet/config.yml`. If the file does not exist, tell the user to run `agent-gauntlet init` first and **STOP** — do not proceed with any further steps.

## Step 2: Check existing config

Read the `entry_points` field from `.gauntlet/config.yml`.

**If `entry_points` is empty (`[]`):** This is a fresh setup. Proceed to Step 3 (full scan).

**If `entry_points` is populated:** Show the user a summary of the current configuration:
- List each entry point with its `path`, `checks`, and `reviews`
- Then ask the user which action to take:

  1. **Add checks** — Scan for tools not already configured. Proceed to Step 3, but filter out any checks that already appear in `entry_points`.
  2. **Add custom** — User describes what they want to add. Skip to Step 6.
  3. **Reconfigure** — Start fresh. Back up existing files first:
     - Rename each `.gauntlet/checks/*.yml` file to `.yml.bak` (overwrite any previous `.bak` files)
     - Rename each custom `.gauntlet/reviews/*.md` file to `.md.bak` (overwrite any previous `.bak` files)
     - Do NOT rename `.gauntlet/reviews/*.yml` files (these are built-in review configs)
     - Clear `entry_points` to `[]` in `config.yml`
     - Proceed to Step 3

## Step 3: Scan the project

Scan the project for tooling signals across 6 check categories:

### Categories to scan

1. **Build** — Build scripts, compiled languages (npm run build, cargo build, go build, make, gradle build, mvn package, etc.)
2. **Lint** — Linters, formatters (eslint, biome, prettier, ruff, golangci-lint, clippy, checkstyle, etc.)
3. **Typecheck** — Static type checkers (tsc --noEmit, mypy, pyright, etc.)
4. **Test** — Test runners, test directories (jest, vitest, pytest, go test, cargo test, mvn test, etc.)
5. **Security (deps)** — Dependency audit tools (npm audit, pip-audit, cargo audit, etc.)
6. **Security (code)** — Static analysis / SAST tools (semgrep, bandit, gosec, etc.)

### Signals to look for

Scan these files for tooling evidence:
- `package.json` — Check `scripts` (build, lint, test, typecheck, format, etc.) and `devDependencies` (eslint, biome, jest, vitest, typescript, prettier, semgrep, etc.)
- `Makefile`, `Taskfile.yml`, `justfile` — Look for targets matching check categories
- `Cargo.toml` — Rust project (cargo build, cargo test, cargo clippy, cargo audit)
- `pyproject.toml`, `setup.py`, `setup.cfg` — Python project; check for tool configs (ruff, mypy, pytest, bandit, pip-audit)
- `go.mod` — Go project (go build, go test, golangci-lint, gosec)
- `build.gradle`, `build.gradle.kts`, `pom.xml` — Java/Kotlin project (gradle build, mvn package)
- Config files that confirm tool presence:
  - `.eslintrc`, `.eslintrc.js`, `.eslintrc.json`, `.eslintrc.yml`, `eslint.config.js`, `eslint.config.mjs` — ESLint
  - `biome.json`, `biome.jsonc` — Biome
  - `ruff.toml`, `.ruff.toml` — Ruff
  - `.golangci.yml`, `.golangci.yaml` — golangci-lint
  - `tsconfig.json` — TypeScript (typecheck)
  - `.prettierrc`, `.prettierrc.js`, `.prettierrc.json`, `.prettierrc.yml`, `prettier.config.js` — Prettier
  - `jest.config.js`, `jest.config.ts`, `jest.config.mjs` — Jest
  - `vitest.config.js`, `vitest.config.ts`, `vitest.config.mjs` — Vitest
  - `pytest.ini`, `conftest.py` — Pytest
  - `.semgrep.yml`, `.semgrep.yaml` — Semgrep
- `.github/workflows/*.yml` — CI workflow files often reveal exact commands for build, lint, test, etc.

**For the "add checks" path:** After scanning, filter out any checks that are already configured in the current `entry_points`.

**If no tools are discovered:** Inform the user that no tools were automatically detected and offer the custom addition flow (skip to Step 6). Still include `code-quality` review in `entry_points`.

## Step 4: Present findings

Show a table of discovered checks:

```
Category        | Tool            | Command                         | Confidence
----------------|-----------------|---------------------------------|-----------
Build           | npm             | npm run build                   | High
Lint            | ESLint          | npx eslint .                    | High
Typecheck       | TypeScript      | npx tsc --noEmit                | High
Test            | Jest            | npx jest                        | High
Security (deps) | npm audit       | npm audit --audit-level=moderate| Medium
Security (code) | Semgrep         | semgrep scan --config auto --error .| Medium
```

**Confidence levels:**
- **High** — Tool config file found AND/OR explicit script in package.json/Makefile
- **Medium** — Tool found in devDependencies or inferred from CI workflow but no dedicated config
- **Low** — Only indirect evidence (e.g., test directory exists but no runner config found)

If a category has no discovered tool, show `(not found)` with `—` for command and confidence.

## Step 5: Ask user to confirm

Ask the user:
1. Which of the discovered checks to enable (default: all)
2. Whether any commands need adjustment (e.g., different flags, different paths)

If the user declines ALL discovered checks, still include the `code-quality` review in `entry_points` and offer the custom addition flow (proceed to Step 6).

After confirmation, proceed to Step 8 (create files).

## Step 6: Add custom

Ask the user:
- Is it a **check** (shell command that passes/fails) or a **review** (AI code review)?

**For checks:**
- Ask: What command should be run?
- Ask: What name for this check? (used as the filename, e.g., `my-check` creates `.gauntlet/checks/my-check.yml`)
- Ask: Which entry point path should it be attached to?
- Ask: Any special settings? (timeout, parallel, run_in_ci, run_locally — explain defaults)

**For reviews:**
- Ask: Use the built-in `code-quality` review or write a custom review prompt?
- If built-in: What name? (creates `.gauntlet/reviews/<name>.yml` with `builtin: code-quality`)
- If custom: What name? What should the review focus on? Write the review prompt.
  - Creates `.gauntlet/reviews/<name>.md` with YAML frontmatter (`num_reviews: 1`) and the review prompt as Markdown content.

## Step 7: Determine source directory

Ask the user for the source directory for the entry point `path` field (e.g., `src/`, `.`, `lib/`), or infer it from project structure:
- If `src/` directory exists and contains source code, suggest `src`
- If `lib/` directory exists and contains source code, suggest `lib`
- Otherwise suggest `.` (project root)

**Skip this step** if adding checks to an existing entry point that already has a path (the "add checks" or "add custom" paths with a pre-existing entry point).

## Step 8: Create check/review files

For each confirmed item, create the appropriate file:

**Checks** — Create `.gauntlet/checks/<name>.yml`:
```yaml
command: <the command>
parallel: true
run_in_ci: true
run_locally: true
```

Add optional fields only when the user specified them (timeout, working_directory, rerun_command, etc.). Refer to `references/check-catalog.md` for the full schema.

**Custom reviews** — Create `.gauntlet/reviews/<name>.md`:
```markdown
---
num_reviews: 1
---

# <Review Name>

<The review prompt content>
```

**Built-in reviews** — Create `.gauntlet/reviews/<name>.yml`:
```yaml
builtin: code-quality
num_reviews: 1
```

## Step 9: Update entry_points

Edit `.gauntlet/config.yml` to update the `entry_points` section:

**Fresh setup (was `entry_points: []`):**
```yaml
entry_points:
  - path: "<source_dir>"
    checks:
      - <check-name-1>
      - <check-name-2>
    reviews:
      - code-quality
```

Always include `code-quality` in the `reviews` list for fresh setups, regardless of what checks the user selected.

**Add checks / Add custom (existing entry points):**
- Append new check names to the appropriate entry point's `checks` list
- Append new review names to the appropriate entry point's `reviews` list
- If the check/review should go on a new entry point (different path), add a new entry point

## Step 10: "Add something else?"

Ask the user: "Would you like to add another check or review?"
- If **yes**: loop back to Step 6 (add custom)
- If **no**: proceed to Step 11

## Step 11: Validate

Run `agent-gauntlet validate` to verify the configuration is valid.

**If validation passes:** proceed to Step 12.

**If validation fails:**
1. Display the validation errors to the user
2. Apply one corrective attempt — fix the issue based on the error message (e.g., fix a typo in a YAML file, correct a missing field, fix an entry_points reference to a non-existent check)
3. Run `agent-gauntlet validate` again
4. If it still fails: **STOP** and ask the user for guidance. Do not attempt further automatic fixes.

## Step 12: Suggest next steps

Tell the user:
- Configuration is complete and validated
- They can now run `/gauntlet-run` to execute the full verification suite
- They can run `/gauntlet-setup` again at any time to add more checks or reconfigure
