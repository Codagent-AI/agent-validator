# Review Eval Report — 2026-05-02

## Summary

Evaluated four new candidate configurations:

- GitHub Copilot CLI + GPT-5.4 Mini on code-quality and all-reviewers combined.
- GitHub Copilot CLI + Claude Haiku 4.5 on code-quality and all-reviewers combined.
- Codex CLI + GPT-5.4 Mini on all-reviewers combined only.
- Codex CLI + GPT-5.5 on all-reviewers combined only.

These were compared against the 2026-04-05 baseline in `docs/eval-report-2026-04-05.md`, where the strongest production recommendation was Copilot Sonnet 4.6 for code-quality plus Copilot GPT-5.3 for security+error-handling, and the strongest single-pass combined reviewers were Copilot Sonnet 4.6 and Codex GPT-5.3.

**Bottom line: neither Haiku nor GPT-5.4 Mini replaces the existing recommended production configs.**

**Best new value candidate: Copilot Haiku 4.5, but only as a fast/cheap smoke reviewer.** It is much faster than Copilot GPT-5.4 Mini and has similar or slightly better recall, but recall is too low to be a primary production reviewer.

**Best new maximum-recall candidate: Codex GPT-5.5 all-reviewers combined, but only if multiple rounds are allowed.** Mean recall is unstable, but the 3-run union found 43/56 issues (0.77), matching the previous best absolute recall tier. Single-run GPT-5.5 is not reliable enough yet.

## Candidates

| Config | Adapter | Model | Effort | Fixture(s) |
|--------|---------|-------|--------|------------|
| copilot-gpt5.4-mini | GitHub Copilot CLI | gpt-5.4-mini | medium | code-quality, all-reviewers |
| copilot-haiku | GitHub Copilot CLI | claude-haiku-4.5 | off | code-quality, all-reviewers |
| codex-gpt5.4-mini | Codex CLI | gpt-5.4-mini | medium | all-reviewers |
| codex-gpt5.5 | Codex CLI | gpt-5.5 | medium | all-reviewers |

## Code-Quality Reviewer (3 runs, 24 ground truth issues)

This was run only for the Copilot candidates, per the final eval plan.

### Recall

| Config | R1 | R2 | R3 | Mean | Std Dev |
|--------|-----|-----|-----|------|---------|
| **copilot-haiku** | 0.42 | **0.58** | 0.58 | **0.53** | 0.08 |
| copilot-gpt5.4-mini | **0.46** | 0.42 | **0.63** | 0.50 | 0.09 |

### Precision

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| **copilot-gpt5.4-mini** | 0.73 | 0.71 | **0.79** | **0.75** |
| copilot-haiku | 0.63 | 0.67 | 0.74 | 0.68 |

### Duration

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| **copilot-haiku** | 31s | 39s | 47s | **39s** |
| copilot-gpt5.4-mini | 117s | 68s | 71s | 85s |

### Comparison to April Baseline

| Config | Mean Recall | Mean Precision | Mean Time |
|--------|-------------|----------------|-----------|
| copilot-sonnet 4.6 low | **0.71** | **0.87** | 105s |
| copilot-haiku 4.5 | 0.53 | 0.68 | **39s** |
| copilot-gpt5.4-mini | 0.50 | 0.75 | 85s |
| codex-gpt5.3 | 0.47 | 0.72 | 85s |
| copilot-gpt5.3 | 0.43 | 0.74 | 52s |

### Analysis

**Haiku is a better value candidate than Copilot GPT-5.4 Mini on code-quality.** It has slightly higher mean recall (0.53 vs 0.50) and is less than half the runtime (39s vs 85s). Precision is lower, but precision is not the primary optimization target here.

**Copilot GPT-5.4 Mini is not compelling.** It improves over the April GPT-5.4 result that was ruled out (0.46 recall in a single medium-effort run), but it still trails Sonnet by 21pp recall and is slower than Haiku. It does not provide a clear value niche.

**Neither new candidate is viable as the primary code-quality reviewer.** Copilot Sonnet 4.6 remains far ahead on recall (0.71 vs 0.50-0.53). If code-quality recall matters, Sonnet is still the production choice.

## All-Reviewers Combined Single-Prompt (3 runs each, 56 ground truth issues)

This is the most relevant comparison for a single-pass reviewer because it covers code-quality, security, and error-handling in one prompt.

### Recall

| Config | R1 | R2 | R3 | Mean | Std Dev |
|--------|-----|-----|-----|------|---------|
| **codex-gpt5.5** | 0.23 | **0.73** | 0.68 | **0.55** | 0.22 |
| copilot-gpt5.4-mini | 0.41 | 0.50 | 0.41 | 0.44 | 0.04 |
| copilot-haiku | 0.43 | 0.41 | 0.46 | 0.43 | 0.02 |
| codex-gpt5.4-mini | 0.41 | 0.29 | 0.45 | 0.38 | 0.07 |

### Precision

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| **copilot-gpt5.4-mini** | **1.00** | 0.93 | 0.96 | **0.96** |
| copilot-haiku | **1.00** | **1.00** | 0.87 | 0.96 |
| codex-gpt5.4-mini | 0.96 | 0.70 | 0.96 | 0.87 |
| codex-gpt5.5 | 0.39 | 0.84 | 0.93 | 0.72 |

### Duration

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| **copilot-haiku** | 39s | 35s | 43s | **39s** |
| codex-gpt5.5 | 86s | 122s | 114s | 107s |
| copilot-gpt5.4-mini | 128s | 146s | 75s | 116s |
| codex-gpt5.4-mini | 133s | 205s | 106s | 148s |

### Three-Run Union Recall

Because the validator can run multiple reviewer rounds, union recall matters when optimizing for maximum recall.

| Config | Issues Found Across 3 Runs | Union Recall |
|--------|----------------------------|--------------|
| **codex-gpt5.5** | **43 / 56** | **0.77** |
| copilot-haiku | 31 / 56 | 0.55 |
| copilot-gpt5.4-mini | 29 / 56 | 0.52 |
| codex-gpt5.4-mini | 28 / 56 | 0.50 |

### Comparison to April Combined Baseline

| Config | Mean Recall | Mean Precision | Mean Time |
|--------|-------------|----------------|-----------|
| copilot-sonnet 4.6 | **0.71** | 0.94 | ~105s |
| codex-gpt5.3 | 0.69 | **0.96** | ~82s |
| copilot-gpt5.3 | 0.59 | 0.94 | ~82s |
| codex-gpt5.5 | 0.55 | 0.72 | 107s |
| copilot-gpt5.4-mini | 0.44 | **0.96** | 116s |
| copilot-haiku | 0.43 | **0.96** | **39s** |
| codex-gpt5.4-mini | 0.38 | 0.87 | 148s |

### Analysis

**Copilot Haiku is the best new value option, but not a production-primary reviewer.** It is extremely fast at ~39s and has precision comparable to the April combined runs, but recall is only 0.43. That is below even the previous weakest combined GPT baseline (copilot-gpt5.3 at 0.59). Use it only when the goal is a fast smoke pass, not comprehensive review.

**Copilot GPT-5.4 Mini is not viable for value.** It costs the same Copilot premium-request unit as Haiku in these runs (0.33 Premium per run), takes roughly 3x longer, and has essentially the same all-reviewers recall (0.44 vs 0.43). Its only advantage is slightly higher code-quality precision, which is not the target metric.

**Codex GPT-5.4 Mini is not viable.** It is slower than every other new config and has the lowest combined recall (0.38). Even accounting for one anomalous run with failed dummy MCP calls, the other two runs only reached 0.41 and 0.45 recall.

**Codex GPT-5.5 is interesting for maximum recall but too volatile for single-run value.** The run-level recall spread is huge: 0.23, 0.73, 0.68. A single GPT-5.5 run can be excellent, but one out of three runs was poor. If the validator runs three rounds and unions findings, GPT-5.5 found 43/56 issues (0.77), which matches the April "best absolute recall" tier. That makes GPT-5.5 viable only for a multi-run maximum-recall mode.

## Value Assessment

### Haiku

**Viable only as a fast smoke reviewer.**

- Code-quality: 0.53 recall in 39s.
- All-reviewers: 0.43 recall in 39s.
- Same 0.33 Copilot Premium request per run as GPT-5.4 Mini in this eval.
- Much faster than GPT-5.4 Mini and roughly equal/better recall.

Haiku is the best low-latency new candidate, but it is not good enough to replace the April recommendation. The value case is "quick cheap signal," not "catch most issues."

### GPT-5.4 Mini

**Not viable as a recommended reviewer.**

- Copilot GPT-5.4 Mini all-reviewers recall is effectively tied with Haiku but much slower.
- Codex GPT-5.4 Mini all-reviewers recall is worse than Haiku and slower than every other new config.
- Neither variant beats the April GPT-5.3 combined baselines.

GPT-5.4 Mini should remain ruled out for this workload.

### GPT-5.5

**Viable for maximum recall experiments, not value mode.**

- Mean all-reviewers recall: 0.55, below April Codex GPT-5.3 combined (0.69) and Copilot Sonnet combined (0.71).
- Best run: 0.73 recall, which is competitive with the best April combined runs.
- Three-run union: 0.77 recall, matching the April "best absolute recall" scenario.
- Precision is the weakest among evaluated combined configs (0.72 mean), but precision is less important than recall for the stated goal.

GPT-5.5 is the only new config that changes the maximum-recall conversation. The problem is consistency.

## Recommendation

### Primary Value Configuration Remains the April Hybrid

> **Keep the April recommendation as the production default.**

| Pass | Adapter | Model | Effort | Prompt |
|------|---------|-------|--------|--------|
| 1 | GitHub Copilot CLI | claude-sonnet-4.6 | low | Code Quality (separate/specialized) |
| 2 | GitHub Copilot CLI | gpt-5.3-codex | medium | Security + Error-Handling (combined) |

Why this still wins:

- Code-quality recall remains Sonnet-dominated: 0.71 vs Haiku 0.53 and GPT-5.4 Mini 0.50.
- The April GPT-5.3 security+error-handling combined pass had 0.79 recall, far above Haiku/GPT-5.4 Mini all-reviewers recall.
- None of the new low-cost candidates beats the previous GPT-5.3 combined value result.

### Fast Smoke Option

> **Use Copilot Haiku only when speed matters more than coverage.**

| Pass | Adapter | Model | Effort | Prompt |
|------|---------|-------|--------|--------|
| 1 | GitHub Copilot CLI | claude-haiku-4.5 | off | All-reviewers combined |

- Mean recall 0.43, precision 0.96, ~39s.
- This is a cheap early warning pass.
- It should not block merges by itself unless the tolerance for missed issues is high.

### Maximum Recall Option

> **Use multiple Codex GPT-5.5 all-reviewers rounds if recall is the only priority.**

| Passes | Adapter | Model | Effort | Prompt |
|--------|---------|-------|--------|--------|
| 3 | Codex CLI | gpt-5.5 | medium | All-reviewers combined |

- Mean single-run recall is only 0.55, but three-run union recall is 0.77.
- This matches the April "best absolute recall" tier, but with much higher variance and more false positives.
- It should be treated as experimental until more rounds confirm whether the bad first run was noise or a systematic instability.

### Quick Reference

| Scenario | Config | Recall | Precision | ~Time |
|----------|--------|--------|-----------|-------|
| **Best production value** | April hybrid: Copilot Sonnet CQ + Copilot GPT-5.3 sec+EH combined | ~0.74 | ~0.85 | ~178s |
| Fast smoke reviewer | Copilot Haiku all-combined | 0.43 | 0.96 | 39s |
| Best new single-run config | Codex GPT-5.5 all-combined | 0.55 | 0.72 | 107s |
| Best new multi-run recall | 3x Codex GPT-5.5 all-combined union | 0.77 | lower / needs dedupe | ~322s |
| Not recommended | Copilot GPT-5.4 Mini all-combined | 0.44 | 0.96 | 116s |
| Not recommended | Codex GPT-5.4 Mini all-combined | 0.38 | 0.87 | 148s |

## Methodology Notes

- Code-quality result: `evals/results/eval-2026-05-01T22-47-12.json`
- Copilot all-reviewers result: `evals/results/eval-2026-05-01T23-33-01.json`
- Clean Codex all-reviewers rerun: `evals/results/eval-2026-05-02T00-17-07.json`
- Judge: Claude CLI default model `claude-sonnet-4-6`, high thinking.
- Adapter tool use disabled for all runs.
- Copilot commands had to use `--prompt`; Copilot CLI failed auth when launched through stdin from the eval harness.
- Codex tools-off mode was tightened to pass `--ignore-user-config` in addition to `--disable shell_tool`.
- One Codex GPT-5.4 Mini run still reported `tool_calls=2`; both were failed calls to a dummy `noop` MCP server, not successful tool access.
- The initial all-reviewers run had a final GPT-5.5 judge timeout at 300s; the clean Codex rerun used a 600s judge timeout and completed.
- Failed Copilot auth result files from before the harness fix are intentionally excluded from this analysis.
