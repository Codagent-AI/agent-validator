# Check Catalog

Reference for check categories, YAML schemas, and examples used by the `/validator-setup` skill.

---

## Check Categories

There are six standard check categories. When scanning a project, look for the signals listed under each category to determine which checks to suggest.

### 1. Build

Compilation and build steps that produce output artifacts from source code.

**What it covers:** Transpilation, compilation, bundling, and any step that transforms source into runnable or distributable output.

**Signals to look for:**
- `package.json` with `build` or `compile` scripts
- `Makefile` with build targets
- `Cargo.toml` (Rust projects)
- `go.mod` (Go projects)
- `build.gradle` or `pom.xml` (Java/Kotlin projects)
- `tsconfig.json` with an `outDir` field (TypeScript compilation)
- `webpack.config.*`, `vite.config.*`, `rollup.config.*` (JS bundlers)

**Example commands:**
- `npm run build`
- `cargo build`
- `go build ./...`
- `make build`
- `./gradlew build`

---

### 2. Lint

Code style enforcement, formatting validation, and static lint rules.

**What it covers:** Linters, formatters (in check mode), and style enforcers that report violations without modifying code.

**Signals to look for:**
- `.eslintrc*` or `eslint.config.*` (ESLint)
- `biome.json` or `biome.jsonc` (Biome)
- `.prettierrc*` (Prettier)
- `ruff.toml` or `pyproject.toml` with `[tool.ruff]` section (Ruff for Python)
- `.golangci.yml` or `.golangci.yaml` (golangci-lint for Go)
- `Cargo.toml` with clippy in CI workflows (Rust clippy)
- `.stylelintrc*` (Stylelint for CSS)
- `package.json` with a `lint` script

**Example commands:**
- `npx eslint .`
- `npx biome check .`
- `ruff check .`
- `golangci-lint run`
- `cargo clippy -- -D warnings`

---

### 3. Typecheck

Static type checking that catches type errors without running code.

**What it covers:** Type checkers, static analyzers that verify type correctness, and language-level type validation.

**Signals to look for:**
- `tsconfig.json` (TypeScript)
- `mypy.ini` or `pyproject.toml` with `[tool.mypy]` section (mypy for Python)
- `pyrightconfig.json` or `pyproject.toml` with `[tool.pyright]` section (Pyright for Python)
- Go projects (type checking is built into `go build` and `go vet`)
- Rust projects (type checking is built into `cargo build`)

**Example commands:**
- `npx tsc --noEmit`
- `mypy .`
- `pyright`
- `go vet ./...`

---

### 4. Test

Unit and integration test execution.

**What it covers:** Running test suites, measuring test outcomes, and verifying code behavior through automated tests.

**Signals to look for:**
- `package.json` with a `test` script
- `test/`, `tests/`, `__tests__/`, or `spec/` directories
- `pytest.ini`, `setup.cfg` with `[tool:pytest]`, or `pyproject.toml` with `[tool.pytest]`
- `Cargo.toml` with `[dev-dependencies]` (Rust test dependencies)
- `*_test.go` files (Go tests)
- `jest.config.*`, `vitest.config.*`, `mocha` config files
- `.bun` test configuration in `package.json` or `bunfig.toml`

**Example commands:**
- `npm test`
- `bun test`
- `pytest`
- `cargo test`
- `go test ./...`
- `./gradlew test`

---

### 5. Security (deps)

Dependency vulnerability auditing. Scans project dependencies for known security vulnerabilities.

**What it covers:** Checking package lock files and dependency manifests against vulnerability databases.

**Signals to look for:**
- `package-lock.json` or `yarn.lock` (npm/yarn audit)
- `bun.lock` or `bun.lockb` (bun audit)
- `requirements.txt`, `Pipfile.lock`, or `poetry.lock` (pip-audit for Python)
- `Cargo.lock` (cargo-audit for Rust)
- `go.sum` (govulncheck for Go)
- `pom.xml` or `build.gradle` (OWASP dependency-check for Java)

**Example commands:**
- `npm audit --audit-level=moderate`
- `bun audit --audit-level=moderate`
- `pip-audit`
- `cargo audit`
- `govulncheck ./...`

---

### 6. Security (code)

Static application security testing (SAST). Scans source code for security vulnerabilities, insecure patterns, and potential exploits.

**What it covers:** Code-level security analysis, pattern matching for dangerous constructs, and enforcement of security best practices.

**Signals to look for:**
- `.semgrepignore` or `.semgrep/` directory (Semgrep)
- `bandit.yml` or `pyproject.toml` with `[tool.bandit]` section (Bandit for Python)
- `.security-lint` config files
- CI workflow files referencing `semgrep`, `bandit`, `codeql`, or `snyk code`

**Example commands:**
- `semgrep --config auto . --error`
- `semgrep scan --config auto --error src`
- `bandit -r .`
- `bandit -r src -c bandit.yml`

---

## Inline Check Schema

Checks should be defined inline in `.validator/config.yml` under the relevant `entry_points[].checks` array. Legacy file-based checks at `.validator/checks/<name>.yml` may still be read by existing projects, but `/validator-setup` should create inline checks.

### Fields

```yaml
# Required
command: "npm run build"            # Shell command to run. Exit code 0 = pass, non-zero = fail.

# Optional
rerun_command: "npm run build"      # Alternative command for verification reruns.
                                    # If omitted, `command` is used for reruns too.
working_directory: "packages/api"   # Working directory override (relative to project root).
                                    # Defaults to the project root.
parallel: true                      # Run in parallel with other checks (default: true).
                                    # Set to false for checks that must run sequentially.
run_in_ci: true                     # Run in CI environments (default: true).
run_locally: true                   # Run locally (default: true).
timeout: 300                        # Timeout in seconds (default: 300). The check is killed if it
                                    # exceeds this duration.
fail_fast: false                    # Stop remaining sequential checks after this one fails
                                    # (optional). Only valid when parallel is false.

# Fix instructions (mutually exclusive -- use at most one)
fix_instructions_file: ".validator/fix/lint-fix.md"  # Path to a markdown file with fix instructions.
fix_with_skill: "validator-fix-lint"                 # Skill name that the agent invokes to auto-fix.
```

### Constraints

- `command` is the only required field.
- `fix_instructions_file` and `fix_with_skill` are mutually exclusive. Specify at most one.
- `fail_fast` can only be set to `true` when `parallel` is `false`. Setting both `fail_fast: true` and `parallel: true` is a validation error.

---

## Example Inline Checks

One complete example per category. These use npm/Node.js conventions; adapt the commands for your project's toolchain and insert them as single-key objects under an entry point's `checks` array.

### build

```yaml
- build:
    command: npm run build
```

### lint

```yaml
- lint:
    command: npx eslint . --max-warnings 0
```

### typecheck

```yaml
- typecheck:
    command: npx tsc --noEmit
```

### test

```yaml
- test:
    command: npm test
```

### security-deps

```yaml
- security-deps:
    command: npm audit --audit-level=moderate
    run_locally: false
```

### security-code

```yaml
- security-code:
    command: semgrep --config auto . --error
    run_locally: false
```

---

## Review Schema

Built-in reviews should be defined inline in `.validator/config.yml` under the relevant `entry_points[].reviews` array. Custom prompt reviews can be stored as Markdown files at `.validator/reviews/<name>.md`.

### Inline Built-in Format

Use this format under an entry point's `reviews` array to reference a built-in review or delegate to a skill.

```yaml
- code-quality:
    builtin: code-quality          # Reference to a built-in review prompt.
    num_reviews: 1                 # Number of review passes (default: 1).
                                   # Higher values dispatch multiple independent reviews.
    run_in_ci: true                # Run in CI environments (default: true).
    run_locally: true              # Run locally (default: true).
    cli_preference:                # Override the default CLI preference for this review (optional).
      - claude
```

### Markdown Format (`.validator/reviews/<name>.md`)

Use this format to write a custom review prompt inline. Configuration is provided via YAML frontmatter.

```markdown
---
num_reviews: 1
# All optional frontmatter fields:
# cli_preference: [claude]
# run_in_ci: true
# run_locally: true
# prompt_file: "path/to/prompt.md"
# skill_name: "my-review-skill"
---

Your custom review prompt goes here. Describe what the reviewer should
evaluate, what standards to apply, and how to report findings.
```

### Built-in Reviews

The `code-quality` built-in is the standard review for general code quality. Reference it with:

```yaml
- code-quality:
    builtin: code-quality
    num_reviews: 1
```

---

## Config entry_points Schema

Entry points are defined in `.validator/config.yml` under the `entry_points` key. Each entry point maps a directory path to the checks and reviews that should run when files in that path change.

```yaml
entry_points:
  - path: "src"                    # Directory path to monitor for changes.
                                   # Use "." for the entire project root.
    checks:                        # Inline check definitions or names that reference another inline check.
      - build:
          command: npm run build
      - lint:
          command: npx eslint . --max-warnings 0
      - typecheck:
          command: npx tsc --noEmit
      - test:
          command: npm test
    reviews:                       # Inline review definitions or names that reference another inline/custom review.
      - code-quality:
          builtin: code-quality
    exclude:                       # Glob patterns to exclude from change detection (optional).
      - "**/*.test.ts"
      - "**/__mocks__/**"
```

### Multiple Entry Points

You can define multiple entry points to apply different checks and reviews to different parts of the project:

```yaml
entry_points:
  - path: "src"
    checks:
      - build:
          command: npm run build
      - lint:
          command: npx eslint . --max-warnings 0
      - typecheck:
          command: npx tsc --noEmit
      - test:
          command: npm test
      - security-deps:
          command: npm audit --audit-level=moderate
          run_locally: false
    reviews:
      - code-quality:
          builtin: code-quality

  - path: "docs"
    checks:
      - lint
    reviews:
      - docs-review
```

### Wildcard Entry Points (Monorepos)

Use a single-level wildcard (`*`) to expand one entry point into one job per changed subdirectory. This is ideal for monorepos where each package has the same toolchain:

```yaml
entry_points:
  # Root: project-wide checks
  - path: "."
    checks:
      - security-deps:
          command: npm audit --audit-level=moderate
          run_locally: false
    reviews:
      - code-quality:
          builtin: code-quality

  # Per-package: expands to one job per changed package
  - path: "packages/*"
    checks:
      - build:
          command: npm run build
      - lint:
          command: npx eslint . --max-warnings 0
      - typecheck:
          command: npx tsc --noEmit
      - test:
          command: npm test
```

Check commands run with the working directory set to the matched package (e.g., `packages/api`), so one inline `test` definition works for all packages sharing the same test runner.

### Split Project Entry Points

For projects with distinct parts (e.g., frontend + backend) that may use different toolchains:

```yaml
entry_points:
  - path: "frontend"
    checks:
      - build-frontend:
          command: npm run build --workspace frontend
      - lint-frontend:
          command: npm run lint --workspace frontend
      - test-frontend:
          command: npm test --workspace frontend
    reviews:
      - code-quality:
          builtin: code-quality

  - path: "backend"
    checks:
      - build-backend:
          command: npm run build --workspace backend
      - lint-backend:
          command: npm run lint --workspace backend
      - test-backend:
          command: npm test --workspace backend
    reviews:
      - code-quality
```

When parts share the same command for a category (e.g., both run `npm test`), define the check inline once and reference it by name from other entry points. When they use different commands, define separate inline checks with a suffix (e.g., `test-frontend`, `test-backend`).

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Directory path to monitor. Relative to project root. Supports single-level wildcards (e.g., `packages/*`). |
| `checks` | array | No | Inline check definitions or names referencing checks defined inline elsewhere in `config.yml`. |
| `reviews` | array | No | Inline review definitions, names referencing reviews defined inline elsewhere in `config.yml`, or custom prompt review names backed by `.validator/reviews/<name>.md`. |
| `exclude` | string[] | No | Glob patterns for files to exclude from change detection within this path. |
