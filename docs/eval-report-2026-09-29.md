---
title: Review Eval Report 2026-09-29
group: Evaluation
order: 13
description: Review benchmark of Codex GPT-6 Astra, Codex GPT-6 Sol, and Claude Sonnet 5.5 at low effort, with dollar cost.
---

# Review Eval Report — 2026-09-29

## Summary

Evaluated three low-effort candidates on the all-reviewers combined fixture, plus a Codex GPT-5.5 control carried over from the 2026-05-02 round:

- Codex CLI + GPT-6 Astra, low effort.
- Codex CLI + GPT-6 Sol, low effort.
- Claude Code + Sonnet 5.5, low effort (first round where Claude effort is actually applied, see #165 / #166).
- Codex CLI + GPT-5.5, medium effort (control).

This is also the first round that records dollar cost for every run.

**Bottom line: Claude Sonnet 5.5 at low effort is the best single-pass reviewer we have measured.** Mean recall 0.82 with 0.93 precision, about $0.24 per run, and the fastest-or-tied runtime. It beats every other candidate in this round on recall, precision, and cost per issue found (except Sol, which is cheaper per issue but misses nearly half the issues).

**GPT-6 Astra is not competitive at low effort.** It is the most expensive and slowest candidate, with unstable recall (0.48–0.75).

**GPT-6 Sol is the budget option.** About $0.09 per run and the lowest cost per true positive, but mean recall is only 0.54.

## Setup

| Item | Value |
|------|-------|
| Fixture | `fixtures/all-reviewers` (56 ground-truth issues across code-quality, security, error-handling) |
| Prompt | Built-in `all-reviewers` combined prompt |
| Runs | 3 per config |
| Tool use | Off for all candidates |
| Judge | Claude Code, `claude-opus-5-5`, thinking budget high |
| Versions | codex-cli 0.157.1; Claude Code 2.1.284; Agent Validator `main` at 21fbb58 plus the eval dollar-cost change |
| Config | `evals/eval-config.2026-09-astra-sol-sonnet55.yml` |

| Config | Adapter | Model | Effort |
|--------|---------|-------|--------|
| claude-sonnet5.5 | Claude Code | claude-sonnet-5-5 | low (`CLAUDE_CODE_EFFORT_LEVEL=low`, `MAX_THINKING_TOKENS=8000`) |
| codex-gpt6-astra | Codex CLI | gpt-6-astra | low (`model_reasoning_effort="low"`) |
| codex-gpt6-sol | Codex CLI | gpt-6-sol | low |
| codex-gpt5.5-ctrl | Codex CLI | gpt-5.5 | medium |

Effort levels share names across adapters but are not calibrated equivalents; compare on measured outcomes and cost, not on the label.

## Results (3 runs each, 56 ground-truth issues)

### Recall

| Config | R1 | R2 | R3 | Mean | Std Dev |
|--------|-----|-----|-----|------|---------|
| **claude-sonnet5.5** | **0.88** | **0.82** | **0.75** | **0.82** | **0.05** |
| codex-gpt6-astra | 0.75 | 0.50 | 0.48 | 0.58 | 0.12 |
| codex-gpt6-sol | 0.45 | 0.64 | 0.52 | 0.54 | 0.08 |
| codex-gpt5.5-ctrl | 0.34 | error | 0.16 | 0.25 (2 valid runs) | — |

### Precision

| Config | R1 | R2 | R3 | Mean | False positives |
|--------|-----|-----|-----|------|-----------------|
| **claude-sonnet5.5** | **0.91** | **0.92** | **0.98** | **0.93** | 5 / 4 / 1 |
| codex-gpt6-sol | 0.74 | 0.60 | 0.60 | 0.65 | 9 / 24 / 19 |
| codex-gpt6-astra | 0.76 | 0.55 | 0.61 | 0.64 | 13 / 23 / 17 |
| codex-gpt5.5-ctrl | 0.40 | error | 0.26 | 0.33 (2 valid runs) | 28 / — / 25 |

### Three-Run Union Recall

| Config | Distinct issues found across 3 runs | Union recall |
|--------|-------------------------------------|--------------|
| **claude-sonnet5.5** | **50 / 56** | **0.89** |
| codex-gpt6-astra | 45 / 56 | 0.80 |
| codex-gpt6-sol | 36 / 56 | 0.64 |
| codex-gpt5.5-ctrl | 18 / 56 | 0.32 |

### Cost and Duration

| Config | Cost R1 / R2 / R3 | Mean $/run | $ per true positive | Cost source | Mean time |
|--------|-------------------|------------|---------------------|-------------|-----------|
| claude-sonnet5.5 | $0.29 / $0.30 / $0.14 | $0.24 | $0.0053 | reported | **92s** |
| codex-gpt6-astra | $0.55 / $0.63 / $0.49 | $0.56 | $0.0172 | list price | 188s |
| **codex-gpt6-sol** | $0.07 / $0.09 / $0.10 | **$0.09** | **$0.0029** | list price | 100s |
| codex-gpt5.5-ctrl | $0.29 / $0.26 / $0.14 | $0.23 | $0.0246 | list price | 91s |

- **Reported** is Claude Code's own `cost_usd`. Sonnet's third run was cheaper because its prompt was served from cache (92k cache-read tokens, no cache writes), so expect $0.14–$0.30 per run depending on cache state.
- **List price** is an API-equivalent estimate from Codex token counts at OpenAI standard-tier prices as of 2026-09-29 (per 1M tokens, input / cached input / output): gpt-6-astra $10 / $1 / $50, gpt-6-sol $2 / $0.20 / $10, gpt-5.5 $5 / $0.50 / $30. It is not what a ChatGPT subscription is billed.
- Judge cost is excluded from candidate cost: $0.34–$0.47 per judged run, $4.42 for the round. Candidate runs totalled $3.36.

## Analysis

**Sonnet 5.5 low is both the most accurate and the most consistent.** Every run exceeded the best mean from any previous round (0.71, April Copilot Sonnet 4.6), precision never fell below 0.91, and no run produced more than 5 false positives. Its three-run union (0.89) also beats the previous best union on this fixture (0.77, Codex GPT-5.5 in 2026-05-02).

**Astra's first run was an outlier.** Run 1 reached 0.75 recall; runs 2 and 3 were 0.50 and 0.48. Run 1 missed all four hardcoded-secret issues while run 2 found all four, so misses at this sample size are noise rather than systematic blind spots. At roughly 2x Sonnet's cost and 2x its runtime, Astra has no niche at low effort. Medium or high effort might change that and was not tested.

**Sol trades recall for cost.** It is the cheapest per true positive, but it misses about half the issues and its precision (0.65) is well below Sonnet's. Use it only as a fast, cheap smoke pass.

**The GPT-5.5 control regressed sharply and is not a reliable baseline this round.** In the 2026-05-02 round it averaged 0.55 recall (0.23 / 0.73 / 0.68). Here it scored 0.34 and 0.16, with 25–28 false positives per run. Run 2 returned JSON with an invalid escape sequence (`` \` `` inside a string), which the parser rejected; after a manual repair it contained 40 findings, which were not judged. The real validator would reject the same output, so it is counted as a failure.

The judge is a confound when comparing to earlier rounds. It is now pinned to `claude-opus-5-5`, and since #166 its `thinking_budget: high` actually applies high effort. Earlier rounds used whatever Claude Code defaulted to, without effort control. A stricter judge would lower absolute recall for every candidate, so comparisons within this round are sound but comparisons to earlier rounds are approximate. Prompt and Codex CLI changes since May are further possible causes of the control's drop and were not isolated.

The two tool-use issues (`sanitize-bypass`, `auth-bypass`) were missed by every config, as expected with tool use off. `go-encode-write-ignored` and `ts-notification-dispatch-crash` were also missed by every config in every run.

## Recommendation

> **Use Claude Code + Sonnet 5.5 at low effort as the default single-pass all-reviewers reviewer.**

| Pass | Adapter | Model | Effort | Prompt |
|------|---------|-------|--------|--------|
| 1 | Claude Code | claude-sonnet-5-5 | low | All-reviewers combined |

- It replaces the April two-pass hybrid (Copilot Sonnet 4.6 code-quality plus Copilot GPT-5.3 security+errors) on both recall and simplicity, at about $0.24 per run.
- For maximum recall, run it multiple times and union the findings (0.89 union recall over three runs).
- For a cheap smoke pass, Codex GPT-6 Sol low costs about $0.09 per run at 0.54 recall.
- Do not use GPT-6 Astra at low effort or GPT-5.5 for this workload.

## Follow-ups

- Test Sonnet 5.5 at medium effort, and Astra at medium or high effort, to see whether effort changes the ranking.
- Re-establish a baseline under the pinned Opus 5.5 judge (for example, re-run the April Copilot Sonnet 4.6 config) so future rounds have a stable control.
- Consider tolerating invalid JSON escapes such as `` \` `` in the review output parser, since GPT-5.5 produced them in a live run.
