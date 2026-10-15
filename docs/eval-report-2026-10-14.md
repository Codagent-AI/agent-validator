---
title: Review Eval Report 2026-10-14
group: Evaluation
order: 14
description: Review benchmark of Claude Haiku 5.5 at low and high effort, compared against the Sonnet 5.5 low-effort default.
---

# Review Eval Report — 2026-10-14

## Summary

Evaluated Claude Code + Haiku 5.5, which was released after the [2026-09-29 round](eval-report-2026-09-29.md), on the same all-reviewers fixture:

- Haiku 5.5 at low effort, 3 runs.
- Haiku 5.5 at high effort, 1 run.

**Bottom line: Haiku 5.5 at low effort matches Sonnet 5.5 low on recall at about a tenth of the cost, but it is noisier and less consistent.** Mean recall 0.80 against Sonnet's 0.82 and mean precision 0.78 against 0.93, at about $0.02 per run against $0.24.

**Sonnet 5.5 low stays the preferred default.** Haiku 5.5 low becomes the budget Claude option, ahead of both Codex GPT-6 Sol configurations on recall and cost.

**Haiku 5.5 at high effort is not worth it.** It took nearly twice as long as low, with lower recall and more false positives.

## Setup

| Item | Value |
|------|-------|
| Fixture | `fixtures/all-reviewers` (56 ground-truth issues across code-quality, security, error-handling) |
| Prompt | Built-in `all-reviewers` combined prompt |
| Runs | 3 for low effort, 1 for high effort |
| Tool use | Off |
| Judge | Claude Code, `claude-opus-5-5`, thinking budget high |
| Versions | Claude Code 2.1.299; Agent Validator at 5d12207 (PR #167 head: dollar cost, location check, corrected ground-truth ranges) |
| Configs | `evals/eval-config.2026-10-haiku55.yml` (low and high, run 1), `evals/eval-config.2026-10-haiku55-low.yml` (low, runs 2–3) |

| Config | Adapter | Model | Effort |
|--------|---------|-------|--------|
| claude-haiku5.5-low | Claude Code | claude-haiku-5-5 | low |
| claude-haiku5.5-high | Claude Code | claude-haiku-5-5 | high |

## Results (56 ground-truth issues)

### Haiku 5.5 Low, Per Run

| Run | Recall | Precision | TP / FP | Cost | Time |
|-----|--------|-----------|---------|------|------|
| R1 | 0.89 | 0.82 | 50 / 11 | $0.023 | 124s |
| R2 | 0.79 | 0.90 | 44 / 5 | $0.021 | 106s |
| R3 | 0.71 | 0.63 | 40 / 23 | $0.017 | 131s |
| **Mean** | **0.80** (std dev 0.07) | **0.78** | — | **$0.020** | **120s** |

### Comparison

| Config | Runs | Mean recall | Union recall | Mean precision | $/run | $ per true positive | Mean time |
|--------|------|-------------|--------------|----------------|-------|---------------------|-----------|
| **claude-sonnet5.5, low** | 3 | **0.82** | 0.89 | **0.93** | $0.24 | $0.0053 | **92s** |
| **claude-haiku5.5, low** | 3 | 0.80 | **0.91** | 0.78 | **$0.02** | **$0.0005** | 120s |
| claude-haiku5.5, high | 1 | 0.86 | — | 0.73 | $0.03 | $0.0007 | 227s |
| codex-gpt6-sol, medium | 1 | 0.70 | — | 0.74 | $0.15 | — | 207s |
| codex-gpt6-sol, low | 3 | 0.54 | 0.64 | 0.65 | $0.09 | $0.0029 | 100s |

Sonnet and Sol figures are from the [2026-09-29 round](eval-report-2026-09-29.md). Cost is Claude Code's reported `cost_usd` for Claude, and an OpenAI list-price estimate for Codex. Judge cost is excluded: about $0.41 per judged run, $2.44 for this round.

## Analysis

**Recall is on par with Sonnet.** Haiku's three-run mean (0.80) is within Sonnet's range, and its union recall (51 of 56 issues found at least once) is slightly higher. Sonnet's mean drops to 0.79 once its judge mis-matches are excluded (see the previous report's judge match audit), so the two are effectively tied.

**Precision and consistency are the weak points.** Run 3 produced 23 false positives (precision 0.63), and recall ranged from 0.71 to 0.89. Run 3 missed `go-path-traversal`, `go-ssrf`, and `go-open-redirect`, which run 1 found, and run 2 missed `go-weak-random-token` and `go-idor-export`. In an automated fix loop, false positives cost agent time and missed security issues are not caught by a single pass, so Sonnet's tighter spread (0.75–0.88 recall, precision never below 0.91) still matters.

**Cost is the advantage.** At about $0.02 per run, Haiku is roughly 12x cheaper than Sonnet low and about 10x cheaper per true positive. Three Haiku runs cost less than a third of one Sonnet run, so unioning several Haiku runs is a cheap way to raise recall if the false positives are acceptable.

**High effort does not help.** The single high-effort run found fewer issues (48 vs 50 in the matching low run), produced more false positives (18 vs 11), and took 227s.

**Location audit.** Haiku low run 1 had 2 location-flagged matches (`py-mutable-default-arg`, `go-defer-in-loop`). Both were checked by hand and are correct findings cited a few lines from the recorded range. No other run had flags.

Every Haiku run missed the two tool-use issues (`sanitize-bypass`, `auth-bypass`) and the two issues every config missed in the previous round (`go-encode-write-ignored`, `ts-notification-dispatch-crash`). It also missed `go-cleanup-notification-error-ignored` in every run.

These runs were scored against the corrected ground-truth ranges, while the 2026-09-29 scores used the original ranges. The previous report found that the correction does not change true-positive counts, so the comparison holds.

## Recommendation

> **Keep Claude Code + Sonnet 5.5 at low effort as the default. Use Haiku 5.5 at low effort as the budget option.**

| Option | Adapter | Model | Effort | When to use |
|--------|---------|-------|--------|-------------|
| Preferred | Claude Code | claude-sonnet-5-5 | low | Default single-pass reviewer |
| Budget | Claude Code | claude-haiku-5-5 | low | Cost-sensitive setups that can tolerate more false positives |

- Do not run Haiku 5.5 at high effort for this workload.
- Haiku 5.5 low replaces Codex GPT-6 Sol low as the cheapest recommended option, since it has higher recall and lower cost.
