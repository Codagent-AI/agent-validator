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
| Codex | `codex exec --json` `turn.completed` usage; mapping `adapter-collection-v1` | Requested/resolved only unless a source event establishes effective identity | `input_total`, `cache_read`, and `output`; cached input is included in input total. `input_uncached`, cache write, reasoning, and provider total remain unavailable unless evidenced. | Sanitized codex-cli 0.153.4 recording establishes the successful input/output baseline and nonzero cached input. The recorded reasoning-output field is not yet mapped. See capture provenance below; no stopped evaluation artifact was modified. |
| Claude | Console OTel token metrics and API-request events; mapping `claude-otel-accounting-v2` | Requested/resolved only; OTel parser does not infer an effective model | Native input is `input_uncached`, not total input. `input_total` is derived only from established uncached + cache-read + cache-write components. Output and cache counters retain source values. Token metrics take precedence over overlapping API events; numeric and quoted integer API fields are supported. | Sanitized Claude Code 2.1.261 baseline and nonzero cache-write recordings establish successful canonical input/output accounting. Collection remains partial; normalized grand total and multi-model/full-run coverage remain unestablished. |
| Gemini | Per-dispatch OTel JSON sink; mapping `gemini-accounting-v2` | Requested/resolved only | Input, output, thought, and cache counters are partial evidence; counter/reset and overlap relationships are not assumed. | Disabled or redirected collection is distinguishable from an unsupported field. The sink is attempt-owned and uses a UUID name. Representative mapping evidence is still required. |
| GitHub Copilot | CLI session summary and model rows; mapping `adapter-collection-v1` | Summary model rows are observed identity; provider and effort remain unavailable unless reported | Input, output, and cache display counts are approximate. No allocation or normalized-total claim is made from summary rows. | Existing sanitized result captures include `[copilot-telemetry]` summary lines. Rounding and source-to-allocation relationships remain explicit limitations. |
| OpenCode | JSONL `step_finish` usage; mapping `opencode-accounting-v2` | Requested/resolved only unless the event reports identity | Input, output, reasoning, and cache fields are preserved as partial event evidence; inclusion relationships are not inferred. | Representative recorded format and category semantics remain required before complete-support claims. |
| Cursor | No established provider usage format | Requested/resolved only | All usage and observed identity fields are explicitly unavailable (`adapter_usage_unsupported`). | A recorded representative source is required before enabling a mapping. |

“Unsupported” means the adapter/source has no established field mapping. “Disabled” or “redirected” means a caller environment prevented the otherwise configured collector from reading its own source; Validator records the limitation without retaining environment values. “Incomplete” means some safe source evidence was retained but coverage or relationships are not established. “Unrecognized” formats retain diagnostics and unavailable fields instead of fabricated zeros.

## Recorded baseline

Codex JSONL events, Claude's bounded console OTel blocks, and OpenCode step events publish intermediate safe evidence checkpoints. Controlled subprocess endings perform final collection before source cleanup; timeout handling permits a bounded final drain and preserves the timeout outcome. Gemini currently collects its attempt-owned file at finalization; Copilot collects its end-of-command summary. Those final-only sources cannot promise recovery of usage that was never committed before an abrupt process kill. The prepared attempt and any previously committed evidence remain the recovery floor, never a zero-consumption claim.

[Native telemetry fixtures and provenance](../test/cli-adapters/fixtures/native-telemetry/README.md) document the authorized capture controls, sanitization, CLI versions, hashes, accounting references and remaining limitations. They enable repeatable offline tests; they do not establish a completed independent acceptance pass or cross-repository integration. Future live captures still require authorization.

Claude mapping `adapter-collection-v1` incorrectly treated uncached input as total input. The corrected adapter mapping version makes that semantic correction identifiable without changing the measurement payload shape. Existing measurements are not silently rewritten or reinterpreted.

## Legacy reports

`review-audit` and `newsletter-metrics` are legacy log-based reports outside this telemetry contract. In particular, `review-audit` has an existing zero-filling limitation: it cannot distinguish unavailable provider data from an observed zero. Machine consumers should use the versioned validation-metrics artifact and handoff instead. This documentation does not change or assert the same limitation in every legacy script.
