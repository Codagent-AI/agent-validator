# Review Eval Report — Cursor + Composer 2 — 2026-04-25

## Summary

This report documents a **full three-phase eval** of the **Cursor CLI** (`agent`) with **`composer-2`**, **tools off**, **thinking low**, and the **Claude Code** adapter as the **LLM judge** (high thinking). No other review adapters (Copilot, Codex) were in the matrix—only **Cursor** for review, **Claude** for scoring.

**Result JSON timestamps are 2026-04-24 (UTC).** This report is dated **2026-04-25** as the publication of those results.

**Headline numbers (mean across runs in each phase):** code-quality about **0.55 precision / 0.55 recall**; **all-reviewers** about **0.56 precision / 0.31 recall**; **security + error-handling combined** about **0.70 precision / 0.65 recall**.

Two adapter runs **failed** (status `error`, zero violations): **code-quality run 2/5** and **all-reviewers run 1/3**. Those runs are included in mean duration; scoring used **miss-all** semantics where the judge did not run on error rows (see [evals/runner.ts](../evals/runner.ts)). Re-running would tighten confidence intervals.

## Candidate

| Label | Review adapter | Model | Effort |
|-------|----------------|-------|--------|
| cursor-composer2 | `cursor` (`agent`) | `composer-2` | low |

| Judge | Adapter | Thinking |
|-------|---------|----------|
| (default) | `claude` (Claude Code CLI) | high |

Configs: [evals/eval-config.cursor-composer2-cq.yml](../evals/eval-config.cursor-composer2-cq.yml), [evals/eval-config.cursor-composer2-all-reviewers.yml](../evals/eval-config.cursor-composer2-all-reviewers.yml), [evals/eval-config.cursor-composer2-security-errors.yml](../evals/eval-config.cursor-composer2-security-errors.yml) (`builtin_prompt` for combined built-ins).

## Results (aggregates)

Ground truth sizes: code-quality **24** issues, all-reviewers **56**, security-errors **32**.

| Phase | Ground truth | Runs | Mean precision | Mean recall | Mean F1 | Mean adapter time |
|-------|----------------|------|----------------|-------------|---------|-------------------|
| Code quality | 24 | 5 | 0.55 | 0.55 | 0.55 | ~115.7s |
| All-reviewers (combined prompt) | 56 | 3 | 0.56 | 0.31 | 0.40 | ~131.8s |
| Security + EH combined | 32 | 3 | 0.70 | 0.65 | 0.67 | ~107.8s |

**Result JSON (local, not in git):** each run writes under `evals/results/` (gitignored). This session’s timestamped files were:

- `eval-2026-04-24T15-19-09.json` — code-quality  
- `eval-2026-04-24T15-32-21.json` — all-reviewers  
- `eval-2026-04-24T15-43-52.json` — security-errors  

Regenerate: from the repo root, run `bun evals/run-eval.ts` with each of the three `--eval-config=evals/eval-config.cursor-composer2-*.yml` files (no `--skip-judge` for full scoring). New files appear in `evals/results/`.

Cursor CLI version recorded in each run: `2026.04.17-787b533`.

## Comparison to [eval-report-2026-04-05.md](eval-report-2026-04-05.md) (Copilot + Codex baselines)

The April 2026-04-05 report benchmarked **copilot-sonnet**, **copilot-gpt5.3**, and **codex-gpt5.3**—not Cursor. Indicative **relative** placement for **cursor-composer2** (this session; alias in eval YAML):

| Slice | April leaders (indicative) | cursor-composer2 (this report) |
|--------|----------------------------|--------------------------------|
| Code quality (24 issues) | copilot-sonnet **0.71 R / 0.87 P**; GPT configs **0.43–0.47 R** | **0.55 / 0.55** — below Sonnet; recall near GPT, precision lower than all three April rows |
| All-reviewers (56) | **0.59–0.71 R**; **0.94–0.96 P** for top configs | **0.31 R / 0.56 P** — well below; one failed run in three |
| Sec+EH only (32) | copilot-gpt5.3 combined **0.79 R / 0.77 P** (only config in that subsection) | **0.65 R / 0.70 P** — below that published row |

**Interpretation:** On this harness, **Cursor + Composer 2** does **not** match **Copilot + Sonnet** from April; on **all-reviewers** the gap is large (recall in particular). The **sec+EH** combined slice is the **closest** to a prior benchmark, but still under the **copilot-gpt5.3** combined numbers from April. Different CLIs, models, and a single session—use as directional, not definitive.

## Methodology

- **Tool use** disabled (`allow_tool_use: false`).
- **Timeouts:** 300s per run (code-quality), 600s (combined fixtures).
- **Judge:** Claude Code, high thinking; optional `judge.model` omitted (harness default).
- **Sequential** runs; no enforced pause between runs (optional 3–4 min pauses in April were for cache confounds—omitted here).

## Next steps

1. Investigate **adapter `error`** runs (retry, log capture from `agent` CLI).
2. Re-run a **5×3×3** campaign after fixes to reduce variance; optionally add **Cursor** to a multi-adapter [evals/eval-config.yml](../evals/eval-config.yml) matrix to compare in one session.
3. Keep [eval-report-2026-04-05.md](eval-report-2026-04-05.md) as the primary **multi-adapter** benchmark reference until a wider matrix includes Cursor.
