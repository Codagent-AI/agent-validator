# Review Eval Framework

## Problem

Agent Validator supports three code review adapters (Claude, Codex, Gemini), each with two configurable dimensions: tool use (on/off) and thinking budget (off/low/medium/high). This creates a large configuration space with no empirical data on which settings produce the best reviews. Without measurement, default configurations are guesses.

## Goal

Build an evaluation framework that answers three questions:

1. **Quality** — Which adapter finds the most real issues with the fewest false positives?
2. **Cost** — How much does each configuration cost in tokens?
3. **Time** — How long does each configuration take?

The framework benchmarks 3 adapters across 4 configurations (tool use on/off x thinking off/high) to find optimal settings that balance these three dimensions.

## Eval Matrix

| Configuration | Tool Use | Thinking | Expected Profile |
|---------------|----------|----------|------------------|
| tools-on / thinking-high | On | High | Highest quality, highest cost |
| tools-on / thinking-off | On | Off | Good quality, moderate cost |
| tools-off / thinking-high | Off | High | Moderate quality, moderate cost |
| tools-off / thinking-off | Off | Off | Baseline quality, lowest cost |

Each configuration runs 3 times per adapter to measure consistency. Total: 3 adapters x 4 configs x 3 runs = 36 adapter invocations per eval.

## Test Fixture Design

### Why real source files (not just diffs)

The key differentiator between tool-use-on and tool-use-off is whether the adapter reads source code beyond the diff. If the test fixture only contains a diff, tool use has nothing to reach for — the eval would show no difference between the two settings.

The fixture includes a small codebase of actual source files that the adapter can navigate when tool use is enabled. The diff modifies some of these files, introducing bugs. Some bugs are visible directly in the diff; others can only be caught by reading files outside the diff.

### Single diff with seeded issues

Rather than many small test cases, the eval uses one diff with ~10 seeded issues of varying difficulty:

- **Easy issues** (3-4): Obvious bugs visible directly in the diff. Any configuration should catch these. Examples: SQL injection via string concatenation, hardcoded secrets, null dereference on nullable return.

- **Medium issues** (3-4): Require understanding context within the diff but no external file reading. Examples: missing await on async operations, timers without cleanup, catch blocks that swallow errors and return success.

- **Hard issues requiring tool use** (3): Only detectable by reading source files outside the diff. Examples: calling a function that looks safe in the diff but has a flaw visible in its implementation file (sanitization bypass, non-atomic session refresh, auth check that skips revocation).

- **Clean sections**: Parts of the diff with no issues, to test false positive rates.

### Ground truth

Each seeded issue has structured metadata: ID, file, line range, description, category (bug/security/performance), difficulty, priority, and whether it requires tool use. This ground truth is the scoring rubric.

## Scoring Approach

### Why LLM-as-judge (not purely deterministic)

We evaluated three scoring approaches:

**Pure deterministic matching** (keyword + line range): Reproducible and free, but brittle. Adapters describe issues in varied language — "null dereference," "missing null check," and "undefined access on optional field" all mean the same thing. A keyword-based matcher would need to anticipate every variation, and would still miss valid findings described differently than expected.

**Pure LLM-as-judge**: Handles semantic variation naturally but adds variance to scoring. When trying to measure adapter consistency, judge variance is a confound.

**Hybrid approach (chosen)**: A well-defined ground truth list combined with an LLM judge that evaluates matches against that list. The judge answers a near-factual question — "does finding X match expected issue Y?" — which LLMs are reliable on. The structured rubric keeps the judge focused and consistent.

### How scoring works

After each adapter run, a judge LLM receives the adapter's violations alongside the ground truth list. It determines:
- **Matches** — which ground truth issues the adapter found (with confidence level)
- **Missed issues** — ground truth issues not detected
- **False positives** — adapter findings that don't match any expected issue

From these, standard metrics are computed: precision (True Positives / reported), recall (True Positives / expected), F1 (harmonic mean).

The judge uses a single consistent model across all runs (Claude with high thinking) to avoid introducing scoring variance.

## Statistical Design

### Multiple runs for consistency

LLM outputs are non-deterministic. Running each configuration 3 times allows measuring:
- **Mean scores** across runs (more reliable than a single measurement)
- **Consistency** per issue: what percentage of runs catch each ground truth issue
- **Overall consistency**: average detection rate across all issues and runs

### Paired comparison

Since all adapters review the same diff, results are naturally paired. Comparing configurations pairwise (e.g., "tool-use-on found this issue 3/3 times, tool-use-off found it 0/3 times") is more statistically powerful than comparing raw scores, because it eliminates variance in issue difficulty.

### Negative test cases

Including clean code sections in the diff tests whether adapters over-report. An adapter that flags everything has high recall but terrible precision — the eval captures both sides.

## Framework Choice: Custom Harness

We evaluated several LLM eval frameworks (Promptfoo, Inspect AI, DeepEval, Braintrust, LangSmith) and chose a custom TypeScript harness for these reasons:

- **Direct adapter access**: The `CLIAdapter.execute()` interface already takes `{ prompt, diff, allowToolUse, thinkingBudget }`. Calling it directly avoids the shell-wrapper indirection that frameworks like Promptfoo require.

- **Custom scoring**: Precision/recall against structured ground truth is straightforward code. General-purpose eval frameworks don't offer this out of the box — you'd write custom scorers anyway.

- **Zero new dependencies**: The eval reuses existing project dependencies (yaml, chalk, zod). No Python runtime, no SaaS accounts, no Docker.

- **Result format fits the use case**: Timestamped JSON files in an `evals/results/` directory, with a console summary table. This is simpler and more useful for periodic on-demand runs than a SQLite database with a web UI.

The tradeoff is no pre-built comparison UI — but for 12 configurations, a console table sorted by F1 is easier to read than a dashboard.

## Expected Insights

The eval should reveal:

1. **Tool use value**: Do the 3 tool-use-required issues get caught significantly more often with tool use enabled? If so, the extra token cost is justified.

2. **Thinking budget value**: Does high thinking budget improve detection of medium/hard issues enough to justify the cost? Or do easy issues dominate the signal?

3. **Adapter ranking**: Which adapter produces the best quality-to-cost ratio? This informs the default `cli_preference` order.

4. **Optimal defaults**: The configuration that maximizes F1 per dollar (or per second) becomes the recommended default.

5. **Consistency**: Which adapter/configuration is most reliable? A config that finds 8/10 issues every time may be preferable to one that finds 10/10 sometimes and 5/10 other times.

## Running the Eval

### Quick start

```bash
# Full eval (all adapters, all configs, multiple runs)
bun run evals/run-eval.ts

# Dry run — validate config and check adapter availability without making API calls
bun run evals/run-eval.ts --dry-run

# Skip judge scoring — run adapters only, no LLM judge pass
bun run evals/run-eval.ts --skip-judge

# Filter to a single adapter
bun run evals/run-eval.ts --adapter=claude

# Filter to a specific configuration
bun run evals/run-eval.ts --config=tools-off-thinking-high

# Combine filters
bun run evals/run-eval.ts --adapter=gemini --config=tools-on
```

### Configuration

Edit `evals/eval-config.yml` to control the eval matrix:

```yaml
fixture: fixtures/review-quality    # path to test fixture (relative to evals/)

matrix:
  adapters:
    - claude
    - codex
    - gemini
  configurations:
    - name: tools-off-thinking-high
      allow_tool_use: false
      thinking_budget: "high"
    # uncomment to add more configurations:
    # - name: tools-on-thinking-high
    #   allow_tool_use: true
    #   thinking_budget: "high"

runs_per_config: 1    # number of runs per adapter/config pair (use 3+ for consistency data)
timeout_ms: 300000    # per-adapter timeout in milliseconds

judge:
  adapter: claude         # which adapter scores the results
  thinking_budget: "high" # thinking budget for the judge
```

### Output

Results are written to `evals/results/eval-<timestamp>.json` and a summary table is printed to the console.

## Interpreting Results

### Configuration comparison table

The main output is a table sorted by F1 score:

```
Config                                Prec    Rec     F1   Cons    Time     Cost    Tokens
------------------------------------------------------------------------------------------
gemini/tools-off-thinking-high        0.86   0.60   0.71    50% 132.2s    n/a     435.0k
codex/tools-off-thinking-high         0.80   0.40   0.53    40%  96.4s    n/a      11.6k
claude/tools-off-thinking-high        0.00   0.00   0.00     0% 124.7s   $0.28     6.8k
```

### Per-issue detection rates

Below the table, each ground truth issue is listed with its detection rate per adapter, grouped by difficulty:

```
EASY (3 issues):
    sql-injection: claude:100%  codex:100%  gemini:100%
    hardcoded-secret: claude:100%  codex:100%  gemini:100%

MEDIUM (4 issues):
    missing-await: claude:0%  codex:0%  gemini:0%
    cache-leak: claude:0%  codex:0%  gemini:100%

HARD (3 issues):
    race-condition [tool-use]: claude:0%  codex:0%  gemini:0%
```

Issues tagged `[tool-use]` require the adapter to read files outside the diff. These should only be detected when `allow_tool_use: true`.

## Glossary

| Term | Column | Definition |
|------|--------|------------|
| **Precision** | `Prec` | Fraction of reported violations that match real issues. `TP / (TP + FP)`. High precision means few false alarms. |
| **Recall** | `Rec` | Fraction of real issues that the adapter detected. `TP / (TP + FN)`. High recall means few missed bugs. |
| **F1 Score** | `F1` | Harmonic mean of precision and recall. `2 * (Prec * Rec) / (Prec + Rec)`. Balances both metrics into a single quality score (0.0 to 1.0). |
| **Consistency** | `Cons` | Average detection rate across all ground truth issues over repeated runs. 100% means every issue was found on every run. |
| **Time** | `Time` | Mean wall-clock duration per run (adapter execution only, not including judge scoring). |
| **Cost** | `Cost` | Total API cost across all runs and judge calls for this config. Only available for adapters that report cost (Claude via `[otel]`). Shows `n/a` when cost data is unavailable. |
| **Tokens** | `Tokens` | Total input + output tokens consumed across all runs and judge calls for this config. |
| **True Positive (TP)** | — | A violation reported by the adapter that matches a ground truth issue. |
| **False Positive (FP)** | — | A violation reported by the adapter that does not match any ground truth issue. |
| **False Negative (FN)** | — | A ground truth issue that the adapter failed to detect (shown as "missed issues"). |
| **Ground Truth** | — | The set of known, seeded issues in the test fixture, each with an ID, file, line range, difficulty, and category. |
| **Judge** | — | An LLM (default: Claude with high thinking) that evaluates whether adapter violations match ground truth issues. Provides semantic matching rather than brittle keyword matching. |
| **Telemetry** | — | Token usage and cost data emitted by adapter CLIs during execution. Parsed from `[otel]`, `[codex-telemetry]`, or `[telemetry]` output lines. |
