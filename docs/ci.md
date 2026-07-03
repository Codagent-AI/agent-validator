---
title: CI Integration
group: Usage
order: 4
description: Configure Agent Validator for GitHub Actions.
---

# CI Integration

Agent Validator can generate a GitHub Actions workflow that discovers which configured checks apply to the current change and runs only those jobs.

## Initialize CI

```bash
agent-validate ci init
```

This creates:

| File | Purpose |
| --- | --- |
| `.validator/ci.yml` | CI runtimes, services, setup steps, and check metadata |
| `.github/workflows/validator.yml` | GitHub Actions workflow |

If `.validator/ci.yml` already exists, the command preserves it and regenerates the workflow.

## CI Config Shape

```yaml
runtimes:
  node:
    version: "22"

services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"

setup:
  - name: Install dependencies
    run: npm ci

checks:
  - name: test
    requires_runtimes:
      - node
    requires_services:
      - postgres
```

The CI schema allows provider-specific runtime and service shapes. Check names refer to check gates configured in `.validator/config.yml` or `.validator/checks/`.

## Dynamic Job Discovery

The generated workflow calls:

```bash
agent-validate ci list-jobs
```

That command reads `.validator/config.yml` and `.validator/ci.yml`, expands changed entry points, and emits the job matrix consumed by the workflow.

## Local Versus CI Gates

Check and review gates can opt in or out of local and CI execution:

```yaml
entry_points:
  - path: "."
    checks:
      - smoke:
          command: npm test
          run_locally: true
          run_in_ci: false
```

AI reviews usually run locally in the agent loop. CI is normally best for deterministic checks.
