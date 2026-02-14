# Multi-Project Entry Point Guide

Reference for configuring entry points in monorepos and split projects. Only read this file if the project was classified as **monorepo** or **split project** in Step 3 of the setup skill.

---

## Entry Point Proposals

### Monorepo

Use a wildcard entry point for packages plus a root entry point for project-wide checks:

```yaml
entry_points:
  # Root: project-wide checks (security audits, etc.)
  - path: "."
    checks:
      - security-deps
    reviews:
      - code-quality

  # Per-package: expands to one job per changed package
  - path: "packages/*"    # or apps/*, services/*
    checks:
      - build
      - lint
      - typecheck
      - test
```

**How wildcards work:** `packages/*` automatically expands at runtime to one job per changed package. Check commands run with the working directory set to the matched package (e.g., `packages/api`), so `npm test` runs inside that specific package. A single `test.yml` check file works for all packages sharing the same test runner.

### Split project — different toolchains (e.g., frontend + backend)

Separate entry point for each logical part:

```yaml
entry_points:
  - path: "frontend"
    checks:
      - build
      - lint
      - test
    reviews:
      - code-quality

  - path: "backend"
    checks:
      - build
      - lint
      - test
    reviews:
      - code-quality
```

Each entry point runs checks from within its own directory. If both parts use the same toolchain, they can share check files. If they use different toolchains, create separate check files (see "Check file naming" below).

### Split project — same language (e.g., multiple apps or libs)

When multiple apps or libraries share the same language and toolchain under a common parent, use a wildcard entry point:

```yaml
entry_points:
  - path: "apps/*"
    checks:
      - build
      - lint
      - test
    reviews:
      - code-quality
```

This works the same as monorepo wildcards — each changed subdirectory gets its own job with the working directory set accordingly. Combine with a root entry point if there are project-wide checks (security, etc.).

---

## Proposing entry points

Present the proposed layout and ask the user to confirm or adjust. They may want to:
- Change directory paths
- Add or remove entry points
- Split a wildcard into individual entry points (or vice versa)
- Add exclusion patterns

---

## Scanning for tooling

**Split project:** Scan within each entry point's directory independently — different parts may use different tools.

**Monorepo with wildcard:** Scan one representative package (the first found, or ask the user which). Also scan the project root for root-level tools (security auditing, etc.).

---

## Presenting findings

Group findings by entry point:

**Split project (different toolchains):**

```
Entry point: frontend/
Category   | Tool       | Command            | Confidence
-----------|------------|--------------------|----------
Build      | Vite       | npm run build      | High
Lint       | ESLint     | npx eslint .       | High
Test       | Vitest     | npx vitest run     | High

Entry point: backend/
Category   | Tool       | Command            | Confidence
-----------|------------|--------------------|----------
Build      | Go         | go build ./...     | High
Lint       | golangci   | golangci-lint run  | High
Test       | Go         | go test ./...      | High
```

**Monorepo (shared toolchain):**

```
Entry point: . (root)
Category        | Tool       | Command                          | Confidence
----------------|------------|----------------------------------|-----------
Security (deps) | npm audit  | npm audit --audit-level=moderate | Medium

Entry point: packages/* (scanned: packages/core)
Category   | Tool       | Command           | Confidence
-----------|------------|-------------------|----------
Build      | TypeScript | npm run build     | High
Lint       | Biome      | npx biome check . | High
Test       | Vitest     | npx vitest run    | High
```

When confirming, also ask the user whether the entry point assignments look correct.

---

## Check file naming

**Shared** — Multiple entry points use the same command for a category (e.g., both run `npm test`). Create one check file (`test.yml`). The working directory is set per entry point at runtime.

**Separate** — Entry points use different commands (e.g., frontend runs `npx vitest run`, backend runs `go test ./...`). Create suffixed files:
- `test-frontend.yml` — `npx vitest run`
- `test-backend.yml` — `go test ./...`

Monorepo wildcard entry points typically use shared check files since all packages share the same toolchain.

---

## Updating entry_points

For multi-entry-point fresh setups, attach `code-quality` review to the entry point covering primary source code (the wildcard or main project entry point, not the root).

When adding checks/reviews to an existing multi-entry-point config, ask the user which entry point(s) to attach to.
