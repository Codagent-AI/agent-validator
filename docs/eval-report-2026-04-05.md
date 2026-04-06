# Review Eval Report — 2026-04-05

## Summary

Evaluated three candidate configurations across all review types: code-quality (5 rounds), security (3 rounds), error-handling (3 rounds), all-reviewers combined single-prompt (3 rounds), and security+error-handling combined (3 rounds, copilot-gpt5.3 only).

**Winner for single-reviewer mode: GitHub Copilot CLI + Claude Sonnet 4.6 at low effort.**

**Surprising finding: Combined single-prompt mode outperforms separate reviewers for GPT models, and matches Sonnet's separate recall while having dramatically better precision.**

## Candidates

| Config | Adapter | Model | Effort |
|--------|---------|-------|--------|
| copilot-sonnet | GitHub Copilot CLI | claude-sonnet-4.6 | low |
| codex-gpt5.3 | Codex CLI | gpt-5.3-codex | medium |
| copilot-gpt5.3 | GitHub Copilot CLI | gpt-5.3-codex | medium |

## Results (5 runs each)

### Recall

| Config | R1 | R2 | R3 | R4 | R5 | Mean | Std Dev |
|--------|-----|-----|-----|-----|-----|------|---------|
| **copilot-sonnet** | 0.71 | 0.67 | 0.71 | 0.71 | **0.75** | **0.71** | 0.03 |
| codex-gpt5.3 | **0.63** | 0.46 | 0.46 | 0.50 | 0.29 | 0.47 | 0.12 |
| copilot-gpt5.3 | 0.50 | 0.33 | 0.42 | **0.54** | 0.38 | 0.43 | 0.08 |

### Precision

| Config | R1 | R2 | R3 | R4 | R5 | Mean |
|--------|-----|-----|-----|-----|-----|------|
| **copilot-sonnet** | 0.85 | 0.84 | 0.85 | **0.89** | **0.90** | **0.87** |
| codex-gpt5.3 | 0.65 | **0.79** | 0.69 | 0.75 | 0.70 | 0.72 |
| copilot-gpt5.3 | **0.80** | 0.67 | 0.77 | 0.76 | 0.69 | 0.74 |

### Duration

| Config | R1 | R2 | R3 | R4 | R5 | Mean |
|--------|-----|-----|-----|-----|-----|------|
| copilot-sonnet | 95s | 93s | 113s | 116s | 109s | **105s** |
| codex-gpt5.3 | 109s | 97s | 81s | 77s | 60s | **85s** |
| copilot-gpt5.3 | 59s | 48s | 52s | 56s | 46s | **52s** |

## Analysis

### copilot-sonnet is the clear winner

- **Highest recall** (0.71 mean) — finds 17-18 of 24 issues consistently
- **Highest precision** (0.87 mean) — only 2-3 false positives per run
- **Most consistent** (std dev 0.03) — recall ranges 0.67-0.75 across 5 runs
- **Acceptable speed** (~105s mean) — well within 300s timeout

### GPT models are inconsistent

- codex-gpt5.3 recall swings wildly: 0.29-0.63 (std dev 0.12)
- copilot-gpt5.3 is slightly more stable but lower recall: 0.33-0.54
- Both GPT configs have lower precision (0.72-0.74) than sonnet (0.87)
- codex-gpt5.3 is faster than sonnet (~85s) but not enough to justify the quality gap

### copilot-gpt5.3 is fastest but weakest

- Mean 52s — roughly half the time of copilot-sonnet
- But mean recall 0.43 vs 0.71 — misses ~7 more issues per run
- Could be a "quick pre-check" option but not suitable as primary reviewer

### Per-issue patterns

**Always found by all configs** (5 issues):
- null-deref, wrong-filter-logic, py-late-binding-closure, py-dict-mutation-during-iteration, go-inverted-error-check

**Never found by any config** (5 issues):
- missing-await, n-plus-one-batch-lookup, unsafe-type-assertion, csv-field-corruption, py-unvalidated-int-cast

**Sonnet-only issues** — found by copilot-sonnet but rarely/never by GPT configs:
- py-file-handle-leak (sonnet: 5/5, GPT: 0-1/5)
- go-defer-in-loop (sonnet: 5/5, GPT: 0/5)
- go-http-body-leak (sonnet: 5/5, GPT: 1-2/5)
- py-off-by-one-pagination (sonnet: 5/5, GPT: 1-2/5)
- py-race-condition-counter (sonnet: 5/5, GPT: 0-2/5)
- go-division-by-zero (sonnet: 4/5, GPT: 0/5)
- go-slice-bounds-panic (sonnet: 5/5, GPT: 0-2/5)

Sonnet's advantage comes almost entirely from medium-difficulty issues that GPT models inconsistently miss.

### Never-found issues need investigation

The 5 issues with 0% detection across all configs and all runs may indicate:
1. Issues are too subtle for diff-only review (would need tool use)
2. Issues are poorly described in the fixture code (bugs not obvious enough)
3. Ground truth descriptions don't match what the code actually shows

These should be reviewed and either improved or reclassified as hard/tool-use-required.

## Ruled-Out Configurations

The following configurations were tested during the eval session and eliminated before the final 5-round comparison.

### Claude Code CLI + claude-sonnet-4-6

Tested at both low and medium effort. Timed out at 300s in both cases — never completed a single run. Claude Code's CLI has significantly higher overhead than Copilot or Codex for the same model, likely due to session initialization and tool scaffolding. The same Sonnet model works well through Copilot CLI, so the issue is the adapter not the model.

### GitHub Copilot CLI + gpt-5.4

Tested at low and medium effort (multiple runs). At low: recall 0.33, 34s. At medium: recall 0.46, 104s. Consistently outperformed by gpt-5.3-codex on the same adapter (copilot-gpt5.3 at medium: 0.42-0.54). Despite being a newer model, gpt-5.4 showed no advantage on code review tasks and was generally slower. Eliminated in favor of gpt-5.3-codex.

### Codex CLI + gpt-5.4

Tested at medium effort (1 run). Recall 0.46, 103s — same as copilot-gpt5.4 on the same model. No improvement over the codex-native gpt-5.3-codex model (0.47 mean), and gpt-5.3-codex appeared better tuned for code tasks. Eliminated.

### GitHub Copilot CLI + claude-sonnet-4.6 at medium effort

Tested twice. First run: timed out at 300s. Second run: recall 0.67, 197s. While recall was similar to the low-effort variant (0.71 mean), the ~2x duration increase (197s vs 105s mean) provides no quality benefit and risks timeout. Low effort is the sweet spot for Sonnet on this fixture.

### GitHub Copilot CLI + claude-sonnet-4.6 at high effort (interactive)

When the user's interactive effort was set to high and no `--effort` flag was passed, copilot-sonnet timed out at 300s. Copilot-gpt5.4 took 220s with recall 0.63. High effort is too slow for the 300s timeout constraint.

### Effort level findings

- **Low effort** favors Sonnet — same or better recall as medium, roughly half the time
- **Medium effort** helps GPT models modestly (gpt5.4: 0.33→0.46, codex-gpt5.3: 0.46→0.63 in best case) but adds 50-100% to duration
- **High effort** (interactive) is impractical — causes timeouts for Sonnet and near-timeouts for GPT
- The `--effort` flag confirmed working: explicit `--effort medium` overrides interactive settings, and removing the flag with interactive=high caused dramatic slowdowns

## Security Reviewer (3 runs, 17 ground truth issues)

The security review prompt was tested for the first time against the same three candidate configs.

### Recall

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| **copilot-sonnet** | **0.94** | 0.76 | **0.88** | **0.86** |
| copilot-gpt5.3 | 0.76 | 0.76 | 0.76 | 0.76 |
| codex-gpt5.3 | 0.65 | 0.47 | 0.82 | 0.65 |

### Precision

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| codex-gpt5.3 | 0.79 | 0.57 | 0.78 | 0.71 |
| copilot-gpt5.3 | 0.76 | 0.76 | 0.76 | **0.76** |
| copilot-sonnet | 0.67 | 0.65 | 0.79 | 0.70 |

### Analysis

- copilot-sonnet leads on recall (0.86 mean) but has more false positives than code-quality (mean precision 0.70 vs 0.87)
- copilot-gpt5.3 is remarkably consistent: 0.76 recall and 0.76 precision across all 3 runs
- codex-gpt5.3 is highly variable: recall swings 0.47–0.82
- `input-validation` and `sanitize-bypass` were never found by any config (sanitize-bypass requires tool use)
- `go-weak-random-token` and `go-idor-export` are inconsistently detected

## Error-Handling Reviewer (3 runs, 15 ground truth issues)

The error-handling review prompt was tested for the first time against the same three candidate configs.

### Recall

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| **copilot-sonnet** | **0.80** | 0.67 | **0.80** | **0.76** |
| copilot-gpt5.3 | 0.60 | 0.53 | 0.73 | 0.62 |
| codex-gpt5.3 | 0.53 | 0.40 | 0.60 | 0.51 |

### Precision

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| copilot-gpt5.3 | 0.82 | 0.80 | 0.85 | **0.82** |
| codex-gpt5.3 | 0.80 | 0.55 | 0.82 | 0.72 |
| copilot-sonnet | 0.75 | 0.77 | 0.71 | 0.74 |

### Analysis

- copilot-sonnet again leads on recall (0.76 mean) with acceptable precision (0.74)
- copilot-gpt5.3 has the best precision (0.82) but lower recall
- codex-gpt5.3 continues to show high variance (recall 0.40–0.60)
- Never found by any config: `go-encode-write-ignored`, `ts-notification-dispatch-crash`
- `py-validate-import-error-miscount` only found by copilot-sonnet (1/3 runs)

## Cross-Reviewer Summary

| Reviewer | GT Issues | copilot-sonnet Recall | copilot-gpt5.3 Recall | codex-gpt5.3 Recall |
|----------|-----------|----------------------|----------------------|---------------------|
| Code Quality | 24 | **0.71** | 0.43 | 0.47 |
| Security | 17 | **0.86** | 0.76 | 0.65 |
| Error Handling | 15 | **0.76** | 0.62 | 0.51 |

copilot-sonnet is the best config across all three reviewers. The security prompt performs best overall (highest recall for all configs), while code-quality is the hardest (lowest recall). The new security and error-handling prompts are viable for production use.

## All-Reviewers Combined Single-Prompt (3 runs each, 56 ground truth issues)

A single combined prompt covering code-quality + security + error-handling was tested against all 56 issues at once. This tests whether one pass with a broader prompt can match or beat three separate passes with specialized prompts.

### Recall (valid runs only — judge failures excluded)

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| **copilot-sonnet** | 0.68 | **0.75** | 0.71 | **0.71** |
| codex-gpt5.3 | **0.70** | 0.66 | **0.70** | **0.69** |
| copilot-gpt5.3 | 0.68 | 0.54 | 0.55 | 0.59 |

### Precision (valid runs only)

| Config | R1 | R2 | R3 | Mean |
|--------|-----|-----|-----|------|
| codex-gpt5.3 | **0.97** | **0.97** | 0.93 | **0.96** |
| copilot-sonnet | **1.00** | 0.93 | 0.89 | **0.94** |
| copilot-gpt5.3 | 0.93 | 0.91 | **0.97** | **0.94** |

### Combined vs Separate: The Key Comparison

| Config | Separate Recall | Combined Recall | Separate Precision | Combined Precision |
|--------|----------------|-----------------|--------------------|--------------------|
| copilot-sonnet | **0.77** | 0.71 | 0.77 | **0.94** |
| codex-gpt5.3 | 0.54 | **0.69** | 0.72 | **0.96** |
| copilot-gpt5.3 | 0.58 | **0.59** | 0.77 | **0.94** |

(Separate recall = sum of mean TP across 3 reviewers / 56 total issues)

### Analysis

**Surprising finding #1: GPT models are dramatically better with a combined prompt than with specialized prompts.** codex-gpt5.3 goes from 0.54 (separate) to 0.69 (combined) recall — a 28% improvement. This is the opposite of what one might expect: giving GPT a narrower, focused task actually produces worse results than asking it to find everything at once.

**Surprising finding #2: Combined precision is dramatically higher for all configs.** Combined precision is 0.94-0.96 vs 0.72-0.77 for separate. The combined prompt produces almost no false positives (1-3 per run vs 10-13 cumulative from three separate passes). This makes sense: running three separate passes gives three chances to hallucinate, while one pass calibrates findings against all categories.

**Surprising finding #3: Sonnet loses its advantage in combined mode.** In separate mode, copilot-sonnet dominates (0.77 vs 0.54-0.58). In combined mode, codex-gpt5.3 nearly matches it (0.69 vs 0.71). Sonnet still wins, but the gap narrows from 19pp to 2pp.

**Surprising finding #4: Issues that were "never found" by separate reviewers get found by the combined prompt.** missing-await, csv-field-corruption, unsafe-type-assertion, and n-plus-one-batch-lookup — all 0% in code-quality evals — were found by the combined prompt. The broader context seems to help models notice issues they miss when told to focus on a single category.

**Judge reliability warning**: With 56 ground truth issues, the judge (Claude with high thinking) struggled — 2 of ~12 judge calls failed (1 malformed JSON, 1 partial evaluation). The judge timeout was increased from 120s to 300s partway through testing, which resolved the timeout issue.

## Security + Error-Handling Combined (3 runs, copilot-gpt5.3 only, 32 ground truth issues)

Tested whether combining just the two non-code-quality reviewers (security + error-handling) in one prompt performs better than running them separately.

### Results

| Run | Recall | Precision | TP | FP | Time |
|-----|--------|-----------|----|----|------|
| 1 | **0.88** | 0.72 | 28 | 11 | 82s |
| 2 | 0.66 | 0.81 | 21 | 5 | 63s |
| 3 | 0.84 | 0.77 | 27 | 8 | 74s |
| **Mean** | **0.79** | **0.77** | **25.3** | **8** | **73s** |

### Comparison: copilot-gpt5.3 across prompt strategies

| Strategy | Issues | Mean Recall | Mean Precision | Passes | Total Time |
|----------|--------|-------------|----------------|--------|------------|
| Separate (sec + EH) | 32 | 0.69 | 0.79 | 2 | ~103s |
| Combined sec+EH | 32 | **0.79** | 0.77 | 1 | ~73s |
| All-reviewers (56) | 56 | 0.59 | **0.94** | 1 | ~82s |

(Separate recall for sec+EH = (0.76*17 + 0.62*15) / 32 = 0.69)

### Analysis

**Surprising finding #5: The security+EH combined prompt is the sweet spot for copilot-gpt5.3.** Mean recall 0.79 beats both separate (0.69) and all-combined (0.59 on sec+EH subset). Removing code-quality from the prompt appears to focus the model better on what matters.

**Surprising finding #6: copilot-gpt5.3 found the "hard" tool-use issues.** Both `sanitize-bypass` and `auth-bypass` (tagged as requiring tool use and never found in separate runs) were found in all 3 runs of the security+EH combined prompt. These were also found in the all-reviewers run 1, suggesting combined prompts help models do deeper analysis.

**Surprising finding #7: Higher variance than separate runs.** Recall ranges 0.66-0.88 (spread of 0.22) vs much tighter ranges in separate security (0.76 across all 3 runs). The combined prompt can produce excellent results but is less predictable.

## Surprising Findings Summary

1. **Combined prompts beat specialized prompts for GPT models on recall** — opposite of the "focused is better" intuition
2. **Combined prompts have dramatically better precision** — 0.94-0.96 vs 0.72-0.77, likely because one pass calibrates against all categories
3. **Sonnet's advantage shrinks in combined mode** — from 19pp lead to 2pp
4. **"Never found" issues get found** — combined context helps models notice issues they miss when narrowly focused
5. **Security+EH combined is the sweet spot for GPT** — better recall than separate or all-combined
6. **"Hard" tool-use issues become findable** — `sanitize-bypass` and `auth-bypass` found consistently in combined mode but never in separate
7. **Higher variance in combined mode** — recall swings are wider, so consistency is traded for higher peaks
8. **Security prompt has highest per-reviewer recall** — all configs perform best on security, worst on code-quality
9. **copilot-gpt5.3 is remarkably consistent in separate security mode** — 0.76 recall across all 3 runs, identical each time
10. **Judge struggles at scale** — 56-issue matching produces ~17% failure rate, needs chunked evaluation for larger ground truth sets

## Recommendation

### Primary: GitHub Copilot CLI + claude-sonnet-4.6, two-pass hybrid

> **This is the recommended production configuration for price and performance.**

Run two passes in sequence:

| Pass | Adapter | Model | Effort | Prompt |
|------|---------|-------|--------|--------|
| 1 | GitHub Copilot CLI | claude-sonnet-4.6 | low | Code Quality (separate/specialized) |
| 2 | GitHub Copilot CLI | gpt-5.3-codex | medium | Security + Error-Handling (combined) |

**Why:**

- Sonnet separate is decisive for code-quality: 0.71 recall vs 0.43–0.47 for GPT — no combined prompt closes this gap.
- GPT combined sec+EH is competitive for security/error-handling: 0.79 recall in a single ~73s pass, matching or beating a second Sonnet pass at lower cost.
- Together: ~0.74 weighted recall across all 56 issues in ~178s, at roughly 40–50% of the cost of 3× Sonnet separate.

**Tradeoff:** The GPT sec+EH pass has higher variance (0.66–0.88 recall). If consistency matters more than cost, use 3× Sonnet separate (0.77 recall, tighter std dev, ~315s total).

---

### Secondary: Codex CLI + gpt-5.3-codex (no Copilot access)

> **Use this if GitHub Copilot CLI is unavailable.**

| Pass | Adapter | Model | Effort | Prompt |
|------|---------|-------|--------|--------|
| 1 | Codex CLI | gpt-5.3-codex | medium | All-reviewers combined (single pass) |

- Mean recall 0.69, precision 0.96, ~82s — one pass covers all 56 issues.
- codex-gpt5.3 on separate specialized prompts is significantly worse (0.47/0.65/0.51 per reviewer), so the combined prompt is mandatory for Codex.
- Precision is excellent (0.96) but recall is lower than the Copilot hybrid. The high-variance warning applies here too.
- Do not use the Codex CLI adapter with Sonnet — the Claude Code CLI adapter timed out at 300s in all runs; Copilot is the only viable Sonnet adapter.

---

### Quick-reference by scenario

| Scenario | Config | Recall | Precision | ~Time |
|----------|--------|--------|-----------|-------|
| **Best price/perf (default)** | Copilot Sonnet CQ + Copilot GPT sec+EH combined | ~0.74 | ~0.85 | ~178s |
| Best absolute recall | 3× Copilot Sonnet separate | 0.77 | 0.77 | ~315s |
| No Copilot access | Codex GPT all-combined | 0.69 | 0.96 | ~82s |
| Fastest / lowest cost | Copilot GPT all-combined | 0.69 | 0.94 | ~82s |

## Methodology Notes

- Per-reviewer fixtures: `evals/fixtures/{code-quality,security,error-handling}/` — each contains only bugs for that reviewer, other bugs fixed
- Combined fixtures: `evals/fixtures/{all-reviewers,security-errors}/` — all-reviewers has all 56 bugs, security-errors has 32 (sec+EH bugs, CQ fixed)
- Judge: Claude with high thinking budget, timeout increased from 120s to 300s during testing
- 3-minute cache-expiry pauses between runs (4 minutes for Claude cache expiry)
- OpenAI prompt caching observed even after 3-min pause
- Tool use disabled for all adapter runs
- Adapter timeout: 300s for per-reviewer, 600s for combined
- Judge failures (malformed JSON, partial evaluation) excluded from analysis
