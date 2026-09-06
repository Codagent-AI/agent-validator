# Handoff: Agent Evals measurement ingestion and valuation integration

## Objective

Consume trustworthy workflow measurements through Agent Runner, including Validator review attempts, and apply evaluation/pricing policy without losing uncertainty, reconstructing metrics from logs, or double-counting attempts.

## Current State

The user approved this cross-product architecture: Validator owns measurement, Runner owns workflow attribution/consolidation, Evals owns evaluation/pricing. The Validator proposal is updated and all four approved specifications are written: `validation-metrics`, `nested-metrics-handoff`, `run-lifecycle`, and `log-management`. Neither a final wire schema nor a completed producer/integration exists yet. The approved handoff uses Validator CLI export and receipt acknowledgment, replacing the earlier JSONL-sink proposal.

The user approved preparing companion review briefs now, resolving contract feedback before implementation, and accepting integrations in the order Validator → Runner → Evals. Implementation can overlap after contracts and fixtures are agreed. This brief is for review/planning; Evals code changes belong to a separately authorized companion change. Do not modify the stopped evaluation artifact or regenerate its metrics.

Inspection during this session found that Evals reads only Runner's `run-metrics.json` for implementation metrics, accepts schema v1/v2 while the current Runner checkout writes v3, hardcodes normalized `usage_source_version` to null, and substitutes zero for omitted cache categories when deriving billing tokens. Its normalized attempt currently assumes a single model. These observations identify integration work, not constraints on the desired architecture; recheck current code before editing.

## Key Decisions

- **Single ingestion authority:** For Runner-driven evaluations, consume Runner's artifact. Do not add direct Validator snapshot ingestion as a fallback or second accounting source. A future standalone Validator evaluation could use Validator's standalone artifact as its own authoritative route.
- **Runner retrieves through Validator's CLI:** Runner supplies original correlation context at launch, exports through a versioned Validator CLI, durably stores the evidence, then calls Validator to acknowledge the opaque receipt for the exact exported revisions. Private storage paths are not part of this contract. Export is non-consuming; acknowledgment of an older revision does not release a newer completion. Evals does not implement this handoff itself or acknowledge on Runner's behalf.
- **Lossless measurement contract:** Runner-native and Validator attempts share versioned measurement semantics within their distinct domain artifacts. Evals must preserve the semantics, not flatten unknown fields into numbers or discard usable aggregate evidence.
- **Identity:** Requested, resolved launch, and telemetry-observed effective identity are distinct. Missing effective identity can prevent pricing without invalidating measured tokens. Preserve producer identifiers and original workflow attribution across retries and recovery.
- **Token accounting:** Canonical fields are `input_total`, `input_uncached`, `cache_read`, `cache_write`, `output`, `reasoning`, and `provider_total`, with availability, provenance, inclusion relationships, precision, and derivation. Total-token completeness does not imply complete billing categories. Omitted/unsupported categories are not observed zero.
- **Multiple models:** Preserve actual per-model allocations, unallocated attempt usage, and independent attribution completeness. Multiple identities do not justify splitting counts equally, duplicating an aggregate across models, or counting one dispatch as several attempts.
- **Provenance:** Retain producer version/build details, parser/mapping version, underlying CLI version or explicit unavailability, and source format/event version or explicit unavailability. Preserve allowlisted provider-native evidence separately from normalized values.
- **Attempts and delivery:** Replayed measurements and successive lifecycle revisions describe the same original work. Actual new dispatches have new attempt IDs. A finalized zero-dispatch invocation is not a model attempt with fabricated provider observations. Incomplete collection and incomplete delivery remain explicit.
- **Pending delivery retention:** The user approved preserving pending Validator telemetry through ordinary cleanup and zero historical retention until Runner acknowledges durable receipt or the user explicitly discards it. Successful export is not acknowledgment; explicit discard is a delivery gap, not zero consumption or successful receipt. Recovery can deliver old measurements later without making them newly incurred work.
- **Aggregates:** Attempts are the authority; aggregate envelopes expose state, known subtotal, fidelity, and coverage per measurement. Never add summaries to attempts or allocation rows to their parent totals. Preserve history, usage, attribution, pricing, and delivery completeness independently.
- **Valuation:** Keep provider-reported cost distinct from Evals-calculated estimates. Record pricing source/version or retrieval date, currency, rates, and approved assumptions. Repricing changes valuation, not the underlying evidence. Unpriceable work yields a known subtotal and incomplete total, not a zero-cost attempt.
- **Timing:** Preserve attempt work duration separately from workflow elapsed/active duration. Parallel and nested work overlaps and must not be added again to elapsed time.
- **Safety:** No prompts, responses, credentials, environment values, or unrestricted provider payloads in the telemetry contract. The stopped eval artifact remains read-only evidence.

## Open Questions

- Exact measurement, handoff, and workflow artifact schemas and their independent compatibility/version policies need agreement with Runner and Validator before implementation.
- Retention until acknowledged durable receipt or explicit user discard, CLI retrieval/acknowledgment, and revision-bound receipts are approved. Exact protocol layout, recovery scheduling, explicit-discard diagnostics, and original-context linkage remain coordinated design work.
- The representation of multiple-model and unallocated measurements in Evals' normalized results/reports must be designed without forcing them into a single-model row or manufacturing prices.

## Next Steps

1. Read the updated Validator proposal and all four change specs. Inspect the current Runner artifact contract and Evals ingestion, result aggregation, pricing, and reporting paths.
2. Review consumer needs against the proposed common measurement contract. Return actionable findings and recommended resolutions to the lead; do not edit Validator planning artifacts or treat older Runner limitations as requirements.
3. Agree representative fixtures with Runner/Validator before producer implementation, including explicit availability and inclusion semantics. Identify required consumer schema upgrades independently of transport schema versions.
4. Plan the separately authorized Evals integration: preserve evidence/version metadata and original attribution, handle multiple/unallocated models, use semantically valid billing categories, and keep valuation separate.
5. Verify the complete Validator → Runner → Evals route after integrations exist. Cover parallel attempts, actual retries vs replay, interruption/recovery, zero dispatch vs missing invocation evidence, requested-only identity, incomplete categories, multiple models, export/acknowledgment failures, and provider-reported cost without producer pricing. No complete end-to-end claim from producer tests alone.

## Relevant Files

- Validator proposal: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/proposal.md`
- Approved handoff spec: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`
- Approved measurement spec: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`
- Approved lifecycle delta: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`
- Approved cleanup delta: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`
- Runner companion brief: `../agent-runner/handoff.md`
- `/Users/paul/codagent/agent-runner/openspec/specs/run-metrics-artifact/spec.md`
- `/Users/paul/codagent/agent-evals/openspec/specs/evaluation-metrics-reporting/spec.md`
- `/Users/paul/codagent/agent-evals/evals/agent-runner/and-scene/lib/runner-metrics.mjs`
- `/Users/paul/codagent/agent-evals/evals/agent-runner/and-scene/lib/result.mjs`
- `/Users/paul/codagent/agent-evals/evals/agent-runner/and-scene/lib/report.mjs`
- `/Users/paul/codagent/agent-evals/test/runner-metrics.test.mjs`
