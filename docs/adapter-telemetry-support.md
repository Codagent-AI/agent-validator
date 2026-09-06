---
title: Adapter Telemetry Support
group: Reference
order: 30
description: Evidence sources, supported fields, and collection limits for review adapters.
---

# Adapter Telemetry Support

Adapter telemetry is evidence, not billing. Validator keeps requested and launch-resolved model configuration separate from provider-observed identity, records unavailable fields as unavailable rather than zero, and does not calculate a price.

| Adapter | Source and mapping | Identity | Usage support | Collection status / prerequisite |
| --- | --- | --- | --- | --- |
| Codex | `codex exec --json` `turn.completed` usage; mapping `adapter-collection-v1` | Requested/resolved only unless a source event establishes effective identity | `input_total`, `cache_read`, and `output`; cached input is included in input total. `input_uncached`, cache write, reasoning, and provider total remain unavailable unless evidenced. | Read-only candidate capture: `evals/results/eval-2026-05-02T00-17-07.json` contains structured completion usage. The checked-in capture establishes field presence; representative provenance and accounting confirmation remain an acceptance prerequisite. |
| Claude | Console OTel metrics and API-request events; mapping `adapter-collection-v1` | Requested/resolved only; OTel parser does not infer an effective model | Input, output, cache read/write are retained only as partial evidence. Metric/request overlap prevents a normalized-total claim. | No approved representative Claude capture currently establishes canonical input/output accounting. This support row is incomplete; no live or paid capture is authorized. |
| Gemini | Per-dispatch OTel JSON sink; mapping `adapter-collection-v1` | Requested/resolved only | Input, output, thought, and cache counters are partial evidence; counter/reset and overlap relationships are not assumed. | Disabled or redirected collection is distinguishable from an unsupported field. The sink is attempt-owned and uses a UUID name. Representative mapping evidence is still required. |
| GitHub Copilot | CLI session summary and model rows; mapping `adapter-collection-v1` | Summary model rows are observed identity; provider and effort remain unavailable unless reported | Input, output, and cache display counts are approximate. No allocation or normalized-total claim is made from summary rows. | Existing sanitized result captures include `[copilot-telemetry]` summary lines. Rounding and source-to-allocation relationships remain explicit limitations. |
| OpenCode | JSONL `step_finish` usage; mapping `adapter-collection-v1` | Requested/resolved only unless the event reports identity | Input, output, reasoning, and cache fields are preserved as partial event evidence; inclusion relationships are not inferred. | Representative recorded format and category semantics remain required before complete-support claims. |
| Cursor | No established provider usage format | Requested/resolved only | All usage and observed identity fields are explicitly unavailable (`adapter_usage_unsupported`). | A recorded representative source is required before enabling a mapping. |

“Unsupported” means the adapter/source has no established field mapping. “Disabled” or “redirected” means a caller environment prevented the otherwise configured collector from reading its own source; Validator records the limitation without retaining environment values. “Incomplete” means some safe source evidence was retained but coverage or relationships are not established. “Unrecognized” formats retain diagnostics and unavailable fields instead of fabricated zeros.

## Legacy reports

`review-audit` and `newsletter-metrics` are legacy log-based reports outside this telemetry contract. In particular, `review-audit` has an existing zero-filling limitation: it cannot distinguish unavailable provider data from an observed zero. Machine consumers should use the versioned validation-metrics artifact and handoff instead. This documentation does not change or assert the same limitation in every legacy script.
