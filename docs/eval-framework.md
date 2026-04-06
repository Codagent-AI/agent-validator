# Review Eval Framework

## Problem

Agent Validator supports multiple code review adapters (Claude Code, Codex CLI, GitHub Copilot CLI), each configurable with different models, aliases, and thinking/effort budgets. This creates a large configuration space with no empirical data on which settings produce the best reviews. Without measurement, default configurations are guesses.

## Goal

Build an evaluation framework that answers three questions:

1. **Quality** -- Which adapter+model combination finds the most real issues with the fewest false positives?
2. **Cost** -- How many tokens does each configuration consume?
3. **Time** -- How long does each configuration take?

The framework benchmarks adapters across configurations to find optimal settings that balance these three dimensions.

## Adapters

The eval supports three adapters, plus alias support for running the same adapter with different models:

| Adapter | CLI | Notes |
|---------|-----|-------|
| `claude` | `claude` | Claude Code CLI. Currently too slow for the 300s timeout in most configurations. |
| `codex` | `codex` | Codex CLI (OpenAI). |
| `github-copilot` | `copilot` | GitHub Copilot CLI. |

Each adapter entry in the config can specify a `model` override and an `alias` that becomes its label in results:

```yaml
adapters:
  - name: codex
    model: gpt-5.3-codex
    alias: codex-gpt5.3
  - name: github-copilot
    model: claude-sonnet-4.6
    alias: copilot-sonnet
  - name: codex
    model: gpt-5.4
    alias: codex-gpt5.4
```

This lets you compare the same adapter across different models without duplicating configuration.

## Per-Reviewer Fixtures

Rather than a single monolithic fixture, the eval uses per-reviewer fixtures. Each built-in reviewer type (code-quality, security, error-handling) has its own fixture directory under `evals/fixtures/<reviewer>/`:

```
evals/fixtures/
  code-quality/
    codebase/       # source files with ONLY code-quality bugs (other bug types are fixed)
    diff.patch      # unified diff of those files
    ground-truth.yml  # only code-quality issues
  security/
    codebase/
    diff.patch
    ground-truth.yml
  error-handling/
    codebase/
    diff.patch
    ground-truth.yml
```

Each fixture's codebase contains bugs specific to that reviewer only -- bugs belonging to other reviewers are fixed in that fixture's source files. This isolation ensures that each eval run measures detection of the exact issue class the reviewer is responsible for.

The config specifies the fixture path (e.g., `fixture: fixtures/code-quality`), and the reviewer prompt file is auto-inferred from the directory name, mapping to the corresponding prompt at `src/built-in-reviews/<reviewer>.md`.

### Issue counts

| Reviewer | Total Issues | Easy | Medium | Languages |
|----------|-------------|------|--------|-----------|
| code-quality | 24 | 9 | 15 | TypeScript, Python, Go |
| security | 15 | -- | -- | TypeScript, Python, Go |
| error-handling | 15 | -- | -- | TypeScript, Python, Go |

### Ground truth

Each seeded issue has structured metadata: ID, file, line range, description, category, difficulty, priority, and reviewer. This ground truth is the scoring rubric.

## Configuration

### Thinking/effort budget

Configurations specify a thinking budget (off/low/medium/high) that controls the adapter's reasoning effort. This is currently specified per-configuration in the matrix but is being refactored to per-adapter, since different adapters map these budget levels to different underlying parameters.

### Tool use

All current testing is tools-off. The tool-use dimension was removed to simplify the eval matrix. Tool use may be revisited in a future iteration.

## Eval Config

Edit `evals/eval-config.yml` to control the eval matrix:

```yaml
fixture: fixtures/code-quality    # path to fixture (relative to evals/)

matrix:
  adapters:
    - name: github-copilot
      model: claude-sonnet-4.6
      alias: copilot-sonnet
    - name: codex
      model: gpt-5.3-codex
      alias: codex-gpt5.3
  configurations:
    - name: tools-off-low
      allow_tool_use: false
      thinking_budget: "low"
    - name: tools-off-medium
      allow_tool_use: false
      thinking_budget: "medium"

runs_per_config: 1    # number of runs per adapter/config pair
timeout_ms: 300000    # per-adapter timeout in milliseconds

judge:
  adapter: claude         # which adapter scores the results
  thinking_budget: "high" # thinking budget for the judge
```

## Scoring Approach

### Why LLM-as-judge (not purely deterministic)

We evaluated three scoring approaches:

**Pure deterministic matching** (keyword + line range): Reproducible and free, but brittle. Adapters describe issues in varied language -- "null dereference," "missing null check," and "undefined access on optional field" all mean the same thing. A keyword-based matcher would need to anticipate every variation, and would still miss valid findings described differently than expected.

**Pure LLM-as-judge**: Handles semantic variation naturally but adds variance to scoring. When trying to measure adapter quality, judge variance is a confound.

**Hybrid approach (chosen)**: A well-defined ground truth list combined with an LLM judge that evaluates matches against that list. The judge answers a near-factual question -- "does finding X match expected issue Y?" -- which LLMs are reliable on. The structured rubric keeps the judge focused and consistent.

### How scoring works

After each adapter run, a judge LLM receives the adapter's violations alongside the ground truth list. It determines:
- **Matches** -- which ground truth issues the adapter found (with confidence level)
- **Missed issues** -- ground truth issues not detected
- **False positives** -- adapter findings that don't match any expected issue

From these, standard metrics are computed: precision (True Positives / reported) and recall (True Positives / expected).

The judge uses a single consistent model across all runs (Claude with high thinking) to avoid introducing scoring variance.

## Token Caching Concern

Runs execute sequentially. Both Claude and OpenAI implement prompt caching with a 5-10 minute TTL. When running multiple configurations back-to-back against the same fixture, later runs may benefit from cached prompts, making their token counts and latencies appear lower than they would in isolation. This is a known confound -- results should be interpreted with this in mind, especially when comparing configurations that run adjacent to each other.

## Running the Eval

### Quick start

```bash
# Full eval (all adapters, all configs)
bun run evals/runner.ts

# Dry run -- validate config and check adapter availability without making API calls
bun run evals/runner.ts --dry-run

# Skip judge scoring -- run adapters only, no LLM judge pass
bun run evals/runner.ts --skip-judge

# Filter to a single adapter
bun run evals/runner.ts --adapter=codex

# Filter to a specific configuration
bun run evals/runner.ts --config=tools-off-low
```

### Output

Results are written to `evals/results/eval-<timestamp>.json` and a summary table is printed to the console.

Cross-session results are accumulated in `evals/results/candidates-comparison.json`, which tracks runs across multiple eval sessions to enable candidate comparison over time.

## Interpreting Results

### Configuration comparison table

The main output is a table sorted by Recall:

```
Configuration Comparison (sorted by Recall):
Config                             Prec    Rec    Time       In      Out    Think    Total  Tools
----------------------------------------------------------------------------------------------------
copilot-sonnet/tools-off-low       0.71   0.71   93.2s    25.1k    1.8k    6.2k    33.1k      0
copilot-sonnet/tools-off-medium    0.68   0.67   95.4s    25.3k    2.1k    8.4k    35.8k      0
codex-gpt5.3/tools-off-medium     0.58   0.63  109.1s    18.7k    3.2k    0.0k    21.9k      0
codex-gpt5.3/tools-off-low        0.52   0.46   97.3s    18.5k    2.8k    0.0k    21.3k      0
codex-gpt5.4/tools-off-medium     0.45   0.38  112.5s    19.1k    3.5k    0.0k    22.6k      0
```

Columns: Prec (precision), Rec (recall), Time (mean wall-clock duration), In/Out/Think/Total (token breakdown), Tools (tool call count -- always 0 in current tools-off configs).

### Per-issue detection rates

Below the table, each ground truth issue is listed with its detection rate per adapter, grouped by difficulty:

```
EASY (9 issues):
    hardcoded-secret:           copilot-sonnet:100%  codex-gpt5.3:100%
    sql-injection:              copilot-sonnet:100%  codex-gpt5.3:100%
    ...

MEDIUM (15 issues):
    missing-await:              copilot-sonnet:0%    codex-gpt5.3:0%
    n-plus-one:                 copilot-sonnet:0%    codex-gpt5.3:0%
    ...
```

## Current Findings

A brief summary of results observed so far:

- **copilot + claude-sonnet-4.6 at low effort**: Best recall (~0.67-0.71), completing in ~93-95s. The strongest configuration tested.
- **codex + gpt-5.3-codex at medium effort**: Second best recall (~0.46-0.63), completing in ~97-109s.
- **gpt-5.3-codex consistently outperforms gpt-5.4** across adapters and configurations.
- **Claude Code adapter**: Too slow to complete within the 300s timeout in most configurations.
- **Persistently undetected issues**: 5 issues have never been detected by any adapter across all runs: `missing-await`, `n-plus-one`, `unsafe-type-assertion`, `csv-field-corruption`, `py-unvalidated-int-cast`.

## Framework Choice: Custom Harness

We evaluated several LLM eval frameworks (Promptfoo, Inspect AI, DeepEval, Braintrust, LangSmith) and chose a custom TypeScript harness for these reasons:

- **Direct adapter access**: The `CLIAdapter.execute()` interface already takes `{ prompt, diff, allowToolUse, thinkingBudget }`. Calling it directly avoids the shell-wrapper indirection that frameworks like Promptfoo require.

- **Custom scoring**: Precision/recall against structured ground truth is straightforward code. General-purpose eval frameworks don't offer this out of the box -- you'd write custom scorers anyway.

- **Zero new dependencies**: The eval reuses existing project dependencies (yaml, chalk, zod). No Python runtime, no SaaS accounts, no Docker.

- **Result format fits the use case**: Timestamped JSON files in an `evals/results/` directory, with a console summary table. This is simpler and more useful for periodic on-demand runs than a SQLite database with a web UI.

The tradeoff is no pre-built comparison UI -- but for the current configuration space, a console table sorted by recall is easier to read than a dashboard.

## Glossary

| Term | Column | Definition |
|------|--------|------------|
| **Precision** | `Prec` | Fraction of reported violations that match real issues. `TP / (TP + FP)`. High precision means few false alarms. |
| **Recall** | `Rec` | Fraction of real issues that the adapter detected. `TP / (TP + FN)`. High recall means few missed bugs. |
| **Time** | `Time` | Mean wall-clock duration per run (adapter execution only, not including judge scoring). |
| **Tokens** | `Total` | Total input + output + thinking tokens consumed across all runs for this config. Broken down into In, Out, and Think columns. |
| **Alias** | -- | A label assigned to an adapter+model pair in the config (e.g., `copilot-sonnet`). Used as the identifier in results tables. |
| **True Positive (TP)** | -- | A violation reported by the adapter that matches a ground truth issue. |
| **False Positive (FP)** | -- | A violation reported by the adapter that does not match any ground truth issue. |
| **False Negative (FN)** | -- | A ground truth issue that the adapter failed to detect (shown as "missed issues"). |
| **Ground Truth** | -- | The set of known, seeded issues in the test fixture, each with an ID, file, line range, difficulty, and category. |
| **Judge** | -- | An LLM (default: Claude with high thinking) that evaluates whether adapter violations match ground truth issues. Provides semantic matching rather than brittle keyword matching. |
| **Fixture** | -- | A per-reviewer test directory containing a codebase, diff.patch, and ground-truth.yml. Each fixture isolates bugs for a single reviewer type. |
| **Telemetry** | -- | Token usage and cost data emitted by adapter CLIs during execution. Parsed from `[otel]`, `[codex-telemetry]`, or `[telemetry]` output lines. |
| **Candidates Comparison** | -- | A JSON file (`evals/results/candidates-comparison.json`) that accumulates results across eval sessions for cross-run comparison. |
