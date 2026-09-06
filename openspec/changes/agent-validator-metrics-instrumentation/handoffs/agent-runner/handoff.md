# Handoff: Agent Runner measurement contract and Validator integration

## Objective

Make Runner the lossless workflow-attribution and consolidation boundary for model measurements, including nested Agent Validator reviews, so Agent Evals consumes one authoritative workflow artifact without scraping or double-counting.

## Current State

The user approved the overall architecture and all four specification capabilities: `validation-metrics`, `nested-metrics-handoff`, `run-lifecycle`, and `log-management`. All four specification artifacts are written. The handoff uses a Validator-owned CLI export/acknowledgment protocol replacing the earlier JSONL-sink proposal. No Validator telemetry implementation, final wire schema, or end-to-end integration is complete. This brief requests contract review before implementation, not an assertion that the producer is ready.

All planning for the current Validator change remains under `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/`. Do not edit its proposal/specs while reviewing. Return actionable findings and recommended resolutions to the lead. Runner implementation belongs in a separately authorized companion change.

Inspection of the sibling checkouts during this session found:

- Runner supplies `AGENT_RUNNER_NESTED_METRICS_PATH` to declared metrics-source steps and reads JSONL after execution.
- Its bridge schema is v1, requires a single effective CLI/provider/model, and treats an empty sink as a metrics gap.
- Bridge `invocation_id` currently denotes a child model dispatch, whereas Validator's command invocation can contain multiple dispatches.
- Nested deduplication currently scopes producer IDs to a Runner parent attempt. Replayed old measurements must not become new work under a later parent.
- Runner's workflow artifact is schema v3; Evals currently accepts only v1/v2. Recheck the current checkout before planning migration; these are observations, not architectural constraints.

## Key Decisions

- **Ownership:** Validator measures its reviews; Runner adds workflow/run/step/execution-session context and consolidates; Evals evaluates and prices. Runner-driven evaluations do not independently count Validator snapshots.
- **CLI boundary, not private files:** Runner supplies correlation context when launching Validator, then calls Validator's versioned metrics export CLI in the original project/configuration context after execution (including failure) and during recovery. Validator resolves storage; Runner does not discover snapshot/outbox filenames. Export and acknowledgment never run validation. This replaces the JSONL sink as the planned integration; do not build both transports initially. Exact command names and context transport remain design work.
- **Receipt acknowledgment:** Export is non-consuming and returns an opaque receipt for the exact consumer/context and record revisions exported. Runner durably incorporates the batch before calling Validator's acknowledgment CLI. An older receipt cannot release a newer completion update. Repeated acknowledgment is harmless; failed persistence or invalid receipts must not release pending evidence. Stable record/revision identities support deduplication if Runner crashes after saving but before acknowledging.
- **Common measurement semantics:** Runner's own adapters and nested measurements use a common versioned vocabulary. Outer workflow and Validator artifacts may differ. Preserve the full accounting/attribution payload rather than translate it into a lossy lowest common denominator.
- **Identity:** Keep requested, resolved launch, and observed effective identities distinct. Resolution is not evidence that a provider used the requested model. Keep Validator session, command invocation, model attempt, Runner execution session, parent step attempt, and provider CLI session identities separate.
- **Tokens:** Preserve canonical `input_total`, `input_uncached`, `cache_read`, `cache_write`, `output`, `reasoning`, and `provider_total`, including availability, inclusion relationships, derivation, and precision. No grand total without established non-overlapping components. Unknown is not zero.
- **Multiple models:** One dispatch remains one measured attempt. Preserve provider-supported per-model allocations and attempt-level unallocated usage with independent attribution completeness. Never fabricate allocations or count allocation rows again as attempts.
- **Versions:** Preserve producer version/build provenance, adapter/parser-mapping version, CLI version or unavailability, and source format/event version or unavailability.
- **Recovery:** Accept attempt lifecycle evidence and invocation finalization with the expected attempt set and collection state. Confirmed zero dispatch is not a missing-metrics gap. Updates/replay must count one original attempt once and retain the original workflow attribution; new dispatches are new attempts. Unrecoverable evidence remains explicitly incomplete.
- **Failure isolation:** Validator warns on publication failures without changing validation outcomes. Local snapshot and handoff availability are independent. Partial valid records remain usable without claiming complete delivery.
- **Pending delivery retention:** The user approved preserving pending telemetry across ordinary cleanup and historical rotation, including `max_previous_logs: 0`, until Runner acknowledges durable receipt or the user explicitly discards it. Successful export alone is not acknowledgment. Pending data can accumulate during broken delivery; silent eviction is not allowed. Explicit discard leaves a delivery gap, not successful receipt. Storage failure still warns and degrades history rather than blocking validation. This does not protect against external directory deletion or disk loss.
- **Aggregation:** Measurements are authoritative; aggregates are deterministic views with per-field state, known subtotal, fidelity, and coverage. Parent usage excludes child usage. Nested/parallel durations must not inflate workflow elapsed time.
- **Evidence safety and pricing:** Carry only allowlisted identity/usage/timing/provenance evidence, including provider-reported cost when available. No prompts, responses, credentials, environment values, or unrestricted event payloads. Do not price or rewrite measurement evidence in the handoff.
- **Approach:** Start with versioned schemas and shared compatibility fixtures, not a new runtime framework/service. Preserve honest uncertainty even where the old Runner contract is less expressive.

## Open Questions

- CLI acknowledgment using an opaque revision-bound export receipt is approved. Receipt persistence, exact CLI spelling, and explicit-discard mechanics remain design questions.
- Exact wire format, independent schema versions, authoritative schema location/distribution, compatibility policy, and capability negotiation remain to be designed.
- Durable replay scheduling, original-parent correlation, interrupted start/final records, and recovery after Runner interruption need coordinated design. No exactly-once transport guarantee has been approved. Runner must be able to invoke the metrics CLI in the original project/configuration environment during recovery.
- Runner-native adapter migration must preserve distinctions between invocation-resolved and telemetry-observed identity without manufacturing new evidence for old runs.

## Next Steps

1. Read the updated Validator proposal and all four change specs. Inspect Runner's current metrics models, adapters, nested transport, collector, and specs.
2. Review the proposed boundaries and contract for implementability. Return consequential incompatibilities with recommended resolutions; do not silently weaken the measurement semantics or modify Validator planning artifacts.
3. Coordinate schema and representative fixtures with the lead and Evals agent before producer implementation. Do not assume a v2 bridge means a v2 workflow artifact; those versions are independent.
4. Plan the separately authorized Runner change: launch correlation, CLI export after success/failure and during recovery, common measurement handling for native and nested attempts, lifecycle/finalization ingestion, durable save before CLI acknowledgment, recovery/deduplication, original context retention, durable artifact migration, and lossless consumer projection. Update the existing JSONL-based spec instead of requiring Validator to implement that superseded transport.
5. Acceptance must cover parallel review attempts under one command, actual retry vs repeated delivery, interrupted/recovered work, zero dispatch vs no matching invocation, unknown effective identity, multiple/unallocated models, export/acknowledgment failures, crash after durable save before acknowledgment, acknowledgment of an older revision, and no repeated tokens/cost/duration. Retain known evidence and explicit gaps together.

## Relevant Files

- Validator proposal: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/proposal.md`
- Approved handoff spec: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`
- Approved measurement spec: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`
- Approved lifecycle delta: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`
- Approved cleanup delta: `/Users/paul/codagent/agent-validator/openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`
- Evals companion brief: `../agent-evals/handoff.md`
- `/Users/paul/codagent/agent-runner/internal/exec/nested_metrics.go`
- `/Users/paul/codagent/agent-runner/internal/model/usage.go`
- `/Users/paul/codagent/agent-runner/internal/metrics/collector.go`
- `/Users/paul/codagent/agent-runner/openspec/specs/run-metrics-artifact/spec.md`
- `/Users/paul/codagent/agent-runner/workflows/core/run-validator-v1.0.yaml`
