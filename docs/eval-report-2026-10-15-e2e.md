---
title: End-to-End Eval Report 2026-10-15
group: Evaluation
order: 15
description: First end-to-end eval. A coding agent fixes what the validator reports, comparing Sonnet 5.5 and Haiku 5.5 as reviewers.
---

# End-to-End Eval Report — 2026-10-15

## Summary

The [2026-10-14 review eval](eval-report-2026-10-14.md) found that Haiku 5.5 at low effort matches Sonnet 5.5's recall at about a tenth of the review cost, but with lower precision. A review eval cannot show what that noise costs downstream. This report uses the new [end-to-end eval](end-to-end-eval.md): a coding agent runs `/validator-run` on a feature branch with seeded problems, fixes what the validator reports, and re-runs until the validator stops. A judge then grades the final code.

Two reviewer setups were compared:

- Sonnet 5.5 at low effort, one combined `all-reviewers` review: the current preferred config.
- Haiku 5.5 at low effort, split into three reviews (`code-quality`, `security`, `error-handling`). This is Haiku's best review-eval setup, with mean recall 0.88 against 0.80 for one combined Haiku review.

**Bottom line: Sonnet with one review is the better reviewer once the fixing work is counted.** With Haiku, the agent handled about twice as many findings, mostly false positives and duplicates. The loop took about 60% longer, fixed fewer seeded problems and broke more working code. Haiku's saving on the review was small or reversed, depending on the agent's model.

**Haiku 5.5 is no longer recommended as a budget reviewer.** It has been removed from the recommended configurations.

## Setup

| Item | Value |
| --- | --- |
| Fixture | `fixtures/all-reviewers`: `base/` plus `diff.patch`, 56 seeded problems in TypeScript, Python and Go |
| Lead agent | Claude Code, prompt `/validator-run`, project settings only, default effort |
| Validator | Default `max_retries` (3), review gates only (the fixture has no tests or linters) |
| Judge | Claude Code, `claude-opus-5-5`, thinking budget high |
| Versions | Claude Code 2.1.300; Agent Validator `feat/eval-e2e` (based on main at c2e37eb) |
| Configs | `evals/e2e/e2e-config.2026-10-pilot.yml` (Opus lead), `evals/e2e/e2e-config.2026-10-sonnet-lead.yml` (Sonnet lead) |

Every lead session loaded the `validator-run` skill from its prompt and called no other skill.

A first harness check run with an Opus lead and a plain-English prompt is excluded. It did not use `/validator-run`, and the judge rubric changed after it.

## Results

### Sonnet 5.5 lead, 2 runs each

| Reviewer | Run | Fixed | Partial | Serious regressions | Findings handled | Validator runs | Final status | Lead $ | Reviewer $ | Total $ | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sonnet, 1 review | R1 | 49/56 | 2 | 1 | 61 | 3 | Passed | $0.69 | $0.70 | $1.39 | 5.7 min |
| Sonnet, 1 review | R2 | 50/56 | 2 | 1 | 51 | 3 | Passed | $0.58 | $0.65 | $1.23 | 4.8 min |
| Haiku, 3 reviews | R1 | 42/56 | 0 | 0 | 123 | 4 | Retry limit exceeded | $1.00 | $0.18 | $1.18 | 8.9 min |
| Haiku, 3 reviews | R2 | 48/56 | 3 | 5 | 113 | 4 | Retry limit exceeded | $0.74 | $0.19 | $0.93 | 7.7 min |

| Reviewer | Fixed (mean) | Serious regressions | Findings | Validator runs | Lead $ | Reviewer $ | Total $ | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Sonnet, 1 review** | **49.5** | **1.0** | **56** | **3** | **$0.63** | $0.67 | $1.31 | **5.2 min** |
| Haiku, 3 reviews | 45.0 | 2.5 | 118 | 4 | $0.87 | **$0.18** | **$1.05** | 8.3 min |

### Opus 5.5 lead, 1 run each

| Reviewer | Fixed | Partial | Serious regressions | Findings handled | Validator runs | Final status | Lead $ | Reviewer $ | Total $ | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Sonnet, 1 review** | 51/56 | 3 | **0** | **57** | **2** | Passed | **$1.28** | $0.54 | **$1.82** | **5.6 min** |
| Haiku, 3 reviews | 52/56 | 1 | 4 | 133 | 4 | Passed | $1.97 | **$0.18** | $2.15 | 11 min |

Lead cost is Claude Code's reported session cost. Reviewer cost is the validator's provider-reported cost for every review attempt in the session. The judge is excluded from the totals; it cost about $0.75–0.90 per run.

The judge also reports medium- and low-severity regressions, about 13 per run for both reviewers apart from one Haiku run with none. Most are deliberate hardening the judge counts as a behavior change, such as added auth checks or changed signatures. That total does not separate the configs, so only serious regressions are compared here.

## Analysis

**The extra findings are mostly noise, and the agent acts on them.** In the [multi-pass review eval](#review-eval-background), Haiku split into three reviews reported about 97 findings per run, including about 26 false positives and 25 duplicates. Sonnet's single review reported about 49, with about 3 false positives and no duplicates. In the end-to-end runs, leads marked nearly every finding fixed: 110–132 per Haiku run, with one skip across all four Haiku runs. The validator-run skill tells the agent to fix valid feedback rather than skip it as out of scope, so false positives turn into code changes.

**That costs time and breaks code.** Haiku runs needed one or two more validator rounds, both Sonnet-lead Haiku runs ended at the retry limit, and every Haiku run took longer. The serious regressions in Haiku runs came from over-broad hardening the reviewers asked for:

- an OAuth callback that requires a state cookie nothing sets;
- an outbound URL allowlist that is empty by default;
- batch updates that silently drop fields;
- new admin-only gates and required arguments on existing endpoints.

**Haiku did not fix more of the seeded problems.** It fixed 45 on average against 49.5 with the Sonnet lead, and tied with the Opus lead (52 against 51). In the Haiku run that fixed only 42, 14 problems were left unfixed, mostly in error handling.

**The cost saving depends on the agent.** Haiku saves about $0.36–0.49 per session on review. The agent spends more handling its findings: $0.69 more with the Opus lead, which made Haiku more expensive overall, and $0.24 more with the cheaper Sonnet lead, which left Haiku about $0.26 cheaper. In either case the saving is small next to the slower loop and the extra breakage.

**Misses are shared.** Every run missed `sanitize-bypass` and `auth-bypass`, which need context from other files that no review flagged. `go-encode-write-ignored` and `ts-notification-dispatch-crash` were missed or only partly fixed in most runs.

### Workflow evidence

An Agent Runner plan-and-implement workflow eval, with one run per combination and scores out of 70, points the same way.

| Implementer | Reviewer | Score | Total cost | Time |
| --- | --- | --- | --- | --- |
| Sonnet 5.5 medium | Sonnet 5.5 low | 60.25 | $6.82 | 83 min |
| Sonnet 5.5 medium | Haiku 5.5 low | 59.75 | $6.85 | 137 min |

Haiku's saving on review (about $1.18) was spent by the implementer and lead, so quality and cost were the same and the run was 54 minutes slower. With a weaker implementer (gpt-6-luna), the Haiku-reviewed run scored about 4 points below the lowest Sonnet-reviewed baseline run.

### Review eval background

The three-review Haiku setup comes from a multi-pass review eval run alongside this one (all-reviewers fixture, 3 runs each, recall counts distinct issues):

| Setup | Mean recall | Precision | Duplicates per run | False positives per run | Findings | $ per review | Time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sonnet, 1 review ([2026-09-29](eval-report-2026-09-29.md)) | 0.82 | 0.93 | 0 | about 3 | about 49 | about $0.24 | 92s |
| Haiku, 1 review ([2026-10-14](eval-report-2026-10-14.md)) | 0.80 | 0.78 | 0 | about 13 | about 58 | about $0.02 | 120s |
| Haiku, 3 reviews | 0.88 | 0.75 | 25 | 26 | 97 | about $0.05 | 124s |
| Sonnet, 3 reviews | 0.80 | 0.63 | 8 | 31 | 84 | about $0.33 | 91s |

Splitting reviews raised Haiku's recall but not its precision, and lowered Sonnet's precision.

## Caveats

- Two runs per reviewer with a Sonnet lead and one with an Opus lead. The direction held in every comparison, but the cost gap is small enough that more runs could move it.
- The judge's verdicts are model judgments. The serious regressions were reviewed from the judge's descriptions, which name concrete broken flows, but were not checked against the code by hand.
- Findings were not individually labeled true or false positive in the end-to-end runs; the false-positive rates come from the review eval.
- The fixture has no tests, so the lead could not catch its own regressions with a test run, as it might in a real project.

## Recommendation

> **Use Claude Code + Sonnet 5.5 at low effort with one `all-reviewers` review.**

- Haiku 5.5 is removed as the budget Claude option. Its lower review cost does not survive the fixing loop.
- Do not split reviews into separate gates for Sonnet. For Haiku, splitting raises recall but adds duplicates and does not fix precision.
- A follow-up could label each end-to-end finding as true or false positive with the review eval's judge, to measure induced rework per reviewer directly.
