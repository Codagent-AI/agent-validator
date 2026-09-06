## ADDED Requirements

### Requirement: Validator-owned metrics retrieval interface

Agent Validator SHALL provide a versioned, machine-readable CLI interface for consumer-scoped telemetry export and acknowledgment. Validator SHALL resolve its own telemetry storage using the project/configuration context supplied to these operations. Consumers MUST NOT need to discover or read private snapshot, archive, or pending-delivery files to perform this handoff. Export and acknowledgment SHALL NOT execute validations, dispatch model work, or create validation-command invocations.

The supported Runner integration SHALL use this pull-and-acknowledge interface rather than require Validator to write `AGENT_RUNNER_NESTED_METRICS_PATH`. The standalone `validation-metrics.json` artifact remains a separate supported surface for standalone callers, not a second accounting source for Runner's integration.

#### Scenario: Export without storage-path knowledge
- **WHEN** Runner requests telemetry using the original validation's project/configuration context and consumer correlation context
- **THEN** Validator resolves the applicable stored evidence and returns a versioned structured response without requiring Runner to supply an internal telemetry filename

<!-- deferred-to-design: Define exact export/acknowledgment CLI spelling, configuration selection, protocol version fields, and structured error shape. -->

#### Scenario: Metrics operations do not rerun validation
- **WHEN** a consumer exports or acknowledges telemetry after validation has failed or completed
- **THEN** the operation launches no checks or model reviews and creates no new validation invocation or model attempt

#### Scenario: Existing sink is not a required second transport
- **WHEN** Runner integrates through the supported export and acknowledgment commands
- **THEN** delivery does not require a JSONL sink path or direct filesystem ingestion of Validator's telemetry

### Requirement: Original consumer context and producer identity

Validator SHALL accept consumer correlation context at validation launch and retain it with the originating command invocation and its model attempts. The context SHALL allow Runner to associate measured work with the original workflow run, execution session, and parent step attempt without replacing Validator's session, command invocation, or model attempt identifiers. Provider CLI session identity SHALL remain separate.

Exports SHALL be scoped to the selected consumer and originating context. Later export, recovery, or acknowledgment SHALL NOT reassign measurements to the invocation or Runner step performing retrieval. Different actual model dispatches SHALL remain distinct even when their adapter, model, gate, or review slot is the same.

#### Scenario: Parallel reviews share a command but not an attempt
- **WHEN** one Runner-correlated Validator command dispatches several parallel reviews
- **THEN** export retains the common originating context and Validator invocation ID with a distinct model attempt ID for each review

#### Scenario: Recovery retrieves work from an earlier execution
- **WHEN** a resumed Runner process exports retained telemetry for an earlier step attempt
- **THEN** the response preserves that earlier work's original context and producer identities rather than attributing its usage to the recovery step

<!-- deferred-to-design: Define launch-time context transport, scope validation, and durable recovery lookup without exposing private storage paths. -->

#### Scenario: Export is isolated to its context
- **WHEN** pending records exist for two distinct originating contexts and a consumer requests one of them
- **THEN** the response does not merge the other context's measurements into the requested work

### Requirement: Semantics-preserving measurement export

Export SHALL project the same recorded evidence used for Validator's standalone telemetry. It SHALL preserve the common versioned model-attempt semantics needed for accounting and attribution: stable producer identities and original consumer context; outcome and timing; requested, resolved, and observed effective identity with provenance and availability; canonical token values and their accounting relationships; allowlisted provider-native usage; derivation and precision; completeness; producer/parser/source version provenance; per-model allocations and unallocated usage; and provider-reported cost when available.

Export MUST NOT invent effective identity, allocate aggregate usage across models without evidence, replace unavailable values with zero, apply pricing policy, or include prompts, responses, credentials, environment values, or unrestricted provider payloads. Exported lifecycle revisions describe updates to one measured attempt, not additive usage events.

#### Scenario: Requested-only identity remains usable evidence
- **WHEN** an attempt has measured usage but no evidence of its effective model
- **THEN** export retains the measured usage and requested/resolved identity while explicitly marking the effective identity unavailable

#### Scenario: Multiple models have only aggregate usage
- **WHEN** an attempt reports several effective models but cannot establish their individual usage allocations
- **THEN** export retains those identities and the unallocated attempt usage without splitting or duplicating the aggregate

#### Scenario: Provider cost passes through without pricing
- **WHEN** a source reports usage and cost together with unrelated response content
- **THEN** export preserves the allowlisted usage and provider-reported cost evidence without calculating a price or exporting the response content

#### Scenario: Export preserves uncertainty and provenance
- **WHEN** recorded usage includes approximate or derived values, unavailable categories, and source/version metadata
- **THEN** export preserves those distinctions and metadata instead of reducing the measurements to unqualified numbers

### Requirement: Invocation evidence distinguishes zero dispatch from missing delivery

Export SHALL include retained attempt lifecycle evidence and invocation finalization. Finalization SHALL identify the invocation outcome, its attempt set, and collection/history limitations so a consumer can distinguish completed delivery, interrupted or partial work, and confirmed zero dispatch. An empty export alone MUST NOT be represented as evidence of zero model consumption.

Previously acknowledged delivery, where established by retained delivery state, SHALL remain distinguishable from a confirmed zero-dispatch invocation. If invocation or delivery evidence cannot be established, the response SHALL state that limitation rather than infer zero consumption.

#### Scenario: Successful command dispatches no models
- **WHEN** a recorded invocation completes without model dispatch, including a legitimate early exit
- **THEN** export includes finalization evidence with an empty attempt set and the recorded outcome, without inventing model attempts or provider usage observations

#### Scenario: Failed command retains measurements
- **WHEN** a command fails after one or more reviews consumed model usage
- **THEN** export retains the failed invocation and attempts with all recorded usage rather than filtering them out because validation failed

#### Scenario: Interruption leaves an unresolved attempt
- **WHEN** initial attempt evidence exists but interruption prevents terminal evidence from being recorded
- **THEN** export preserves the attempt identity and known evidence with explicit incompleteness rather than treating it as zero work or a completed attempt

#### Scenario: No matching invocation exists
- **WHEN** a consumer requests a context for which Validator cannot establish invocation evidence
- **THEN** export reports missing or unavailable evidence rather than a successful zero-dispatch measurement

#### Scenario: All exported revisions were previously acknowledged
- **WHEN** no unacknowledged revisions remain and retained state establishes prior delivery
- **THEN** export distinguishes that state from a command that dispatched no models

### Requirement: Non-consuming exports and revision-bound receipts

A successful export of pending evidence SHALL return an opaque receipt bound to the selected consumer/context and the exact record revisions in that export. Export SHALL NOT itself acknowledge delivery or release pending evidence. Exporting while recording continues SHALL produce a coherent batch whose receipt cannot acknowledge revisions omitted from that batch.

The consumer contract SHALL require durable incorporation of the exported evidence before acknowledgment. Validator SHALL treat acknowledgment as the consumer's assertion of durable receipt; successful export alone does not establish it.

#### Scenario: Consumer crashes before durable incorporation
- **WHEN** Runner exports a batch and crashes before saving it or acknowledging its receipt
- **THEN** the unacknowledged evidence remains available for retrieval with the same producer record identities and revisions

#### Scenario: Completion arrives after an in-progress export
- **WHEN** an export contains an in-progress attempt revision and a completion revision is recorded afterward
- **THEN** the earlier receipt covers only the exported revision and cannot release the later completion revision

<!-- deferred-to-design: Define record revision representation, coherent export batching, and durable receipt representation. -->

### Requirement: Idempotent and scoped acknowledgment

Validator SHALL provide a structured acknowledgment operation accepting an export receipt. A successful acknowledgment SHALL durably record receipt of only the covered revisions and MAY release their pending-delivery copies. It SHALL NOT delete newer or unrelated pending evidence or alter measured usage, validation outcomes, or ordinary snapshot/history retention.

Repeated acknowledgment SHALL be harmless. An invalid or mismatched receipt SHALL NOT release any pending evidence. If acknowledgment cannot be durably recorded, the operation SHALL report failure and preserve recoverability rather than report successful receipt.

#### Scenario: Consumer saves then crashes before acknowledgment
- **WHEN** Runner durably incorporates a batch but crashes before acknowledging it
- **THEN** Validator permits replay of the pending evidence with stable record identities and revisions so Runner can deduplicate it and subsequently acknowledge it

#### Scenario: Acknowledgment is retried
- **WHEN** Runner repeats an acknowledgment whose effect was already durably recorded
- **THEN** Validator reports the already-acknowledged or successful state without releasing unrelated evidence or changing consumption

#### Scenario: Older receipt does not discard new completion
- **WHEN** Runner acknowledges a receipt for an earlier attempt revision after a newer completion revision was recorded
- **THEN** the newer revision remains pending and exportable

#### Scenario: Receipt does not match the requested scope
- **WHEN** an acknowledgment supplies an invalid receipt or one bound to a different consumer/context
- **THEN** Validator reports the error without releasing pending evidence

#### Scenario: Acknowledgment persistence fails
- **WHEN** Validator cannot durably record the acknowledgment
- **THEN** the CLI reports failure and does not release evidence that would make retry or recovery impossible

### Requirement: Pending evidence survives ordinary cleanup

For consumer-correlated work, Validator SHALL retain pending delivery evidence until the applicable receipt is acknowledged or the user explicitly discards the evidence. Ordinary log cleanup, session closure, historical rotation, and `max_previous_logs: 0` MUST NOT evict pending evidence. Pending evidence SHALL NOT itself trigger rerun/current-log detection or reopen a closed validation session.

Pending delivery storage is independent of historical log retention and may accumulate while delivery remains broken. These guarantees apply to successfully persisted evidence under Validator-managed operations, not external directory deletion, disk loss, or a write that failed. Explicit discard SHALL be a distinct user-directed action with a visible delivery-gap result, not ordinary cleanup, acknowledgment, or proof of zero usage.

#### Scenario: Cleanup uses zero historical retention
- **WHEN** an invocation has unacknowledged evidence and ordinary cleanup runs with `max_previous_logs: 0`
- **THEN** the pending evidence remains retrievable through the CLI despite removal of disposable logs and omission of historical archives

#### Scenario: Later sessions rotate historical logs
- **WHEN** subsequent sessions close and rotate older logs while earlier delivery remains unacknowledged
- **THEN** pending evidence for the earlier context remains retrievable with its original attribution

#### Scenario: Only pending telemetry remains
- **WHEN** no ordinary current logs remain but pending delivery evidence exists
- **THEN** its presence does not classify the next validation as a retry of a closed session or trigger ordinary log rotation

#### Scenario: User explicitly discards pending evidence
- **WHEN** the user explicitly selects pending evidence for discard
- **THEN** Validator reports the affected scope and a delivery gap rather than reporting acknowledged delivery or zero consumption
- **AND** unrelated pending evidence is preserved

<!-- deferred-to-design: Define explicit-discard CLI syntax and durable delivery-gap representation, including acknowledgment/discard concurrency. -->

### Requirement: Handoff failures are explicit and independent

Validation-time telemetry storage failures SHALL warn without changing validation outcomes or exit codes. Standalone snapshot publication and consumer delivery SHALL have independently observable states. Export or acknowledgment commands SHALL report their own operational failures through structured diagnostics and a failing command status, rather than return a successful empty measurement or acknowledgment. Such metrics-operation failures MUST NOT retroactively alter validation results.

#### Scenario: Snapshot publication succeeds but export fails
- **WHEN** a validation snapshot exists but the consumer export operation cannot read or serialize the applicable evidence
- **THEN** export reports its failure without claiming zero usage or invalidating the recorded validation outcome

#### Scenario: Validation-time persistence fails
- **WHEN** telemetry persistence fails while validation is executing
- **THEN** validation continues with a warning and explicitly degraded telemetry state rather than claiming the evidence was durably retained

#### Scenario: Consumer cannot interpret the exported protocol
- **WHEN** Runner cannot support an exported protocol version and therefore does not acknowledge its receipt
- **THEN** Validator retains the unacknowledged evidence for subsequent compatible retrieval rather than treating export as delivery completion
