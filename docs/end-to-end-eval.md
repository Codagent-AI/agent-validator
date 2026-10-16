---
title: End-to-End Eval
group: Evaluation
order: 2
description: Measures a reviewer setup by what a lead agent actually fixes and what the whole loop costs.
---

# End-to-End Eval

The [review eval](eval-framework.md) scores a reviewer's findings against seeded issues. It cannot say what a reviewer costs in practice: every finding, real or not, is read, triaged and acted on by the coding agent that runs the validator. A cheap reviewer that reports many duplicates and false positives can cost more overall than a pricier, cleaner one.

The end-to-end eval measures the whole loop. A lead agent runs the validator on a feature branch with seeded problems, fixes what it reports and re-runs until the validator stops. Only the reviewer configuration changes between runs.

## What a run does

1. **Workspace.** A fresh git repo is created in the OS temp directory. `main` holds the fixture's `base/` code, a generated `.validator/config.yml` for the reviewer setup under test, and the validator skills under `.claude/skills/`. The fixture's `diff.patch` is applied as uncommitted changes on a `feature` branch, as if an agent had just written the feature. An `agent-validate` shim on the lead agent's `PATH` runs this checkout's `dist/index.js`.
2. **Lead agent.** Claude Code runs headless in the workspace with the prompt `/validator-run`, which invokes the validator-run skill explicitly. It loads project settings only (`--setting-sources project`, `--strict-mcp-config`), so the user's hooks, plugins, MCP servers and CLAUDE.md files do not apply. Session variables from a launching Claude Code session are removed.
3. **Evidence.** The validator's log directory is read after the lead stops: every review finding from every run, each fix or skip decision, the number of validator runs, the final status, and the reviewer's provider-reported cost from `validation-metrics.json`.
4. **Oracle.** Every final `.ts`, `.py` and `.go` file is parsed, and a judge model receives the seeded problem list, the final code and the lead agent's own diff. For each seeded problem it returns `fixed`, `partially_fixed`, `not_fixed` or `removed` (functionality deleted instead of fixed), and it lists regressions the lead's changes introduced.

## Metrics

| Metric | Meaning |
| --- | --- |
| Fixed | Seeded problems the judge rates `fixed` in the final code |
| Partial, removed | Problems only mitigated, or "fixed" by deleting the functionality |
| Regressions | New problems introduced by the lead agent's changes |
| Syntax errors | Final source files that no longer parse |
| Findings | Review violations reported across all validator runs: the lead's triage load |
| Fix / skip | Decisions the lead recorded with `update-review` |
| Validator runs | `run` invocations during the session |
| Lead activity | Whether the prompt's skill was loaded, any other skills the lead invoked, and every `agent-validate` command it ran, so a lead that bypasses the skill is visible |
| Lead $, reviewer $ | Claude Code's reported cost for the lead session; the validator's provider-reported reviewer cost |
| $ per fix | Mean total cost divided by mean problems fixed |

A cost is unknown, not zero, when any part of it was not reported.

## Running

Prerequisites: Claude Code logged in, the reviewer CLIs under test installed, and `python3` and `gofmt` for the syntax checks (a missing checker is recorded, not treated as a failure). The harness uses this checkout's build, so build first.

```bash
bun run build:npm

# Create one sample workspace and print its path, without running any agent
bun evals/e2e/run-e2e.ts --e2e-config=evals/e2e/e2e-config.2026-10-pilot.yml --dry-run

# Run every config
bun evals/e2e/run-e2e.ts --e2e-config=evals/e2e/e2e-config.2026-10-pilot.yml

# One config, three runs
bun evals/e2e/run-e2e.ts --e2e-config=evals/e2e/e2e-config.2026-10-pilot.yml --config=haiku55-low-3review --runs=3

# Skip the judge, e.g. while debugging the lead agent
bun evals/e2e/run-e2e.ts --e2e-config=evals/e2e/e2e-config.2026-10-pilot.yml --skip-oracle
```

Runs are sequential. Results are written to `evals/results/e2e-<timestamp>.json` after every run, including the lead's final message and activity, all findings, the lead's diff and the judge's per-issue reasoning. Workspaces are kept so a run can be inspected afterwards; each holds the lead's full `stream-json` transcript in `lead-transcript.jsonl`.

A run spends real money: the lead agent's session dominates, and the judge adds about a dollar. Set `lead.max_budget_usd` to cap a runaway session.

## Config

```yaml
fixture: fixtures/all-reviewers   # needs base/, diff.patch, ground-truth.yml
runs_per_config: 1

lead:
  model: claude-opus-5-5
  effort: high                    # optional, passed as --effort
  timeout_ms: 3600000
  max_budget_usd: 25              # optional, passed as --max-budget-usd

judge:
  adapter: claude
  model: claude-opus-5-5
  thinking_budget: high

configs:
  - label: haiku55-low-3review
    adapter: claude
    model: claude-haiku-5-5
    thinking_budget: low
    reviews: [code-quality, security, error-handling]   # one review gate each
```

## Fixture

The eval uses the review eval's `all-reviewers` fixture: its `diff.patch` and `ground-truth.yml`, plus `base/`, the code before the diff. `base/` exists because the fixture's `codebase/` copy was reformatted after the diff was written and no longer reverse-applies the diff. A fixture for this eval needs a `base/` that `diff.patch` applies to cleanly.

The fixture has no test suite or build, so the validator config contains only review gates, and the oracle relies on the judge plus parse checks rather than behavioral tests.

## Limits

- The judge's verdicts are model judgments. They are more reliable than review matching, because the judge reads concrete final code, but hidden behavioral tests would be stronger.
- One lead agent, Claude Code, is supported.
- Lead behavior varies from run to run; compare configs over several runs.
