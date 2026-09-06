## ADDED Requirements

### Requirement: Validator-owned metrics retrieval interface

Agent Validator SHALL provide a versioned, machine-readable CLI interface for consumer-scoped telemetry export and acknowledgment. Validator SHALL resolve its own telemetry storage using the project/configuration context supplied to these operations. Consumers MUST NOT need to discover or read private snapshot, archive, or pending-delivery files to perform this handoff. Export and acknowledgment SHALL NOT execute validations, dispatch model work, or create validation-command invocations.

The supported Runner integration SHALL use this pull-and-acknowledge interface rather than require Validator to write `AGENT_RUNNER_NESTED_METRICS_PATH`. The standalone `validation-metrics.json` artifact remains a separate supported surface for standalone callers, not a second accounting source for Runner's integration.

Export and acknowledgment SHALL remain usable against valid committed delivery evidence during unfinished session closure, including after a crash. They SHALL NOT require another validation, `clean`, archive-journal completion, or acquisition of the validation run lock. Short telemetry metadata coordination MAY be required. A later closure operation SHALL preserve intervening delivery dispositions rather than restore a stale index. Unfinished closure alone SHALL NOT yield an error requiring the caller to run validation or cleanup.

#### Scenario: Retrieve and acknowledge after a closure crash without validation
- **WHEN** Validator crashes during closure after committing consumer delivery evidence and the consumer resumes solely to collect that evidence
- **THEN** metrics export returns the committed records and metrics acknowledgment can durably acknowledge their exact receipt without another validation or clean command
- **AND** subsequent closure recovery does not undo that acknowledgment or reassign the measurements

#### Scenario: Archive conflict does not block intact delivery evidence
- **WHEN** an unfinished archive operation requires intervention but committed delivery records and receipt state remain valid and accessible
- **THEN** export and acknowledgment remain usable without repairing the archive first

#### Scenario: Export without storage-path knowledge
- **WHEN** Runner requests telemetry using the original validation's project/configuration context and consumer correlation context
- **THEN** Validator resolves the applicable stored evidence and returns a versioned structured response without requiring Runner to supply an internal telemetry filename

The interface SHALL expose `metrics capabilities`, `metrics pending`, `metrics export`, `metrics acknowledge`, and `metrics discard`. Scoped export/acknowledgment/discard operations SHALL accept `--project <dir>` (default cwd), optional `--config <file>` relative to that project, `--consumer <name>`, `--context <id>`, and `--protocol-version <version>`. Export SHALL additionally accept repeatable `--measurement-version <version>` options declaring the consumer's supported measurement versions and optional `--max-records <count>`; acknowledgment and discard SHALL accept `--receipt <opaque-token>`. Discard SHALL require `--confirm`. Pending inventory SHALL accept the same project/configuration/protocol selection, an optional consumer filter, and bounded `--limit`/opaque `--after` pagination without requiring a known context.

Capabilities SHALL advertise supported operations and independent protocol, measurement, and artifact versions through `capabilities_version: 1` without requiring project configuration or creating storage. It SHALL also advertise documented default/maximum inventory/export counts, byte budgets, and maximum individual record size. Valid record bounds SHALL permit at least one retained record plus response overhead to fit a supported export batch. Excessive requested limits SHALL yield `invalid_arguments`. The initial new protocol and common measurement versions SHALL each be `1`, independently of existing Runner versions. Data responses SHALL identify `protocol_version`, producer metadata, operation, `ok`, and diagnostics; exports SHALL also identify `measurement_schema_versions`, the distinct versions actually returned. Each metrics command SHALL emit one JSON response to stdout. Operational and argument errors SHALL use `ok: false` with `error.code`, safe `error.message`, and `error.retryable`, and exit nonzero. Unsupported versions SHALL be explicit and SHALL NOT cause silent downgrade or acknowledgment.

The measurement and record-envelope contracts SHALL use the closed versioned allowlists specified by `validation-metrics`. A consumer SHALL validate every record against its negotiated protocol and measurement schemas before durable incorporation and acknowledgment, preserving all accepted fields including already-declared optional fields. Undeclared fields or unsupported versions SHALL cause explicit rejection without acknowledgment; consumers SHALL NOT strip those fields and acknowledge a lossy projection or forward them as opaque evidence. Adding a record-envelope field requires a protocol-version change; adding a measurement field requires a measurement-version change.

Each revision SHALL identify its own `measurement_schema_version` and preserve it in its digest input and every delivery. Producer upgrades SHALL NOT relabel retained evidence. Before issuing an export receipt, Validator SHALL check that the selected pending scope's measurement versions are supported by both producer and caller, reporting `unsupported_version` and the required set if not. It SHALL NOT silently filter unsupported revisions from a seemingly complete scope. The response version set SHALL NOT substitute for per-record interpretation or aggregate conversion.

#### Scenario: Mixed-version pending evidence is exported losslessly
- **WHEN** a pending scope includes revisions from two supported measurement versions and the consumer declares both
- **THEN** bounded export preserves each revision's original version and digest, and reports the versions present in its returned batch
- **AND** the revisions remain replacement evidence rather than new consumption or rewritten historical measurements

#### Scenario: One pending measurement version is unsupported
- **WHEN** the selected scope includes a retained measurement version outside the caller's declared support set
- **THEN** export returns the required-version incompatibility without issuing a partial-scope receipt or consuming any revision

#### Scenario: Undeclared field is rejected without acknowledgment
- **WHEN** an exported record contains a field outside the consumer's supported closed schema
- **THEN** the consumer reports incompatibility without forwarding or silently dropping the field and does not acknowledge the receipt
- **AND** pending evidence remains available for a compatible consumer

Storage resolution SHALL read location configuration without loading or validating review definitions or invoking model/check work. Default configuration selection SHALL match validation's `.validator/config.yml` then legacy `.gauntlet/config.yml` selection. Missing configuration MAY use the documented default location; unreadable/malformed location configuration SHALL report its limitation. Recovery requires the original project/configuration location; automatic migration when `log_dir` changes or storage is externally moved/deleted is not promised. A missing location or record SHALL NOT establish zero usage.

#### Scenario: Invalid review definition does not prevent retrieval
- **WHEN** location configuration remains usable but a configured review definition is invalid
- **THEN** metrics export can retrieve retained evidence without loading that review definition or executing validation

#### Scenario: Protocol is unsupported
- **WHEN** a caller requests an unsupported protocol or measurement version
- **THEN** the command returns a structured unsupported-version error and supported-version information
- **AND** pending evidence remains unacknowledged and retained

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

The validation commands SHALL accept paired `--metrics-consumer <name>` and `--metrics-context <id>` options. The context SHALL be an opaque bounded correlation identifier, not a private telemetry filename. Runner's integration contract SHALL require it to durably map that identifier to its original workflow run, execution session, and parent step attempt before launch and retain the original project/configuration context for recovery. Validator SHALL validate scope identifiers as data and SHALL NOT interpret them as filesystem paths. Separate invocations using the same context SHALL remain separately identifiable.

#### Scenario: Recovery uses a durable launch mapping
- **WHEN** Runner resumes after interruption and exports using an earlier launch's saved project/configuration and consumer/context identifiers
- **THEN** exported records retain the original invocation and attempt identities and can be joined to the saved original parent mapping
- **AND** retrieval does not require Runner to know private storage filenames

#### Scenario: Export is isolated to its context
- **WHEN** pending records exist for two distinct originating contexts and a consumer requests one of them
- **THEN** the response does not merge the other context's measurements into the requested work

### Requirement: Semantics-preserving measurement export

Export SHALL project the same recorded evidence used for Validator's standalone telemetry. It SHALL preserve the common versioned model-attempt semantics needed for accounting and attribution: stable producer identities and original consumer context; outcome and timing; requested, resolved, and observed effective identity with provenance and availability; canonical token values and their accounting relationships; allowlisted provider-native usage; derivation and precision; completeness; producer/parser/source version provenance; per-model allocations and unallocated usage; and provider-reported cost when available.

Export SHALL preserve allocation IDs, observed-identity IDs/references, and `provider_reported_costs[]` with stable evidence IDs, exact scope/allocation references, currency availability, coverage, and overlap relationships. Consumers SHALL be able to join usage and cost within the same attempt revision without inferring joins from array order or a model label. Unknown identity/scope/currency SHALL remain explicit. No export transformation SHALL promote allocation cost to complete attempt cost.

#### Scenario: Scoped cost and allocation join survives export and replay
- **WHEN** a multi-model attempt includes one attributed allocation, unallocated remaining usage, and cost reported only for that attributed allocation
- **THEN** standalone and exported evidence preserve the same stable allocation/identity/cost references and partial coverage
- **AND** replay retains those references without counting another attempt or assigning cost to the remaining usage

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

An export SHALL identify `store_id`, `consumer_context`, `export_id`, `evidence_state`, `records`, `batch`, `delivery_gaps`, and `receipt`. Evidence state SHALL distinguish `pending`, `previously_acknowledged`, `discarded`, and `missing`; pending evidence MAY coexist with explicit delivery gaps. No matching invocation SHALL return `missing` and no receipt rather than a zero-dispatch claim. Version 1 SHALL NOT include `context_records`: complete replacement records retain their original parent identities and consumers retain their already incorporated evidence. Missing required parent evidence SHALL remain a gap, not fabricated context.

Records SHALL identify `record_type` (`invocation` or `model_attempt`), `record_id` (the invocation ID or attempt ID respectively), positive integer `revision`, per-revision `measurement_schema_version`, producer/version metadata, original consumer context, and a complete replacement `payload`. Newer revisions SHALL replace earlier views of the same record, not add usage. Conflicting payloads claiming the same record/revision SHALL yield a diagnostic rather than arbitrary replacement or addition.

Each record SHALL carry `digest.algorithm: sha256`, `digest.canonicalization: rfc8785`, and a lowercase hexadecimal `digest.value`. Digest input SHALL be the RFC 8785 JCS UTF-8 serialization of the complete record excluding only its top-level `digest` member. Duplicate object names, invalid Unicode, and non-finite numbers SHALL be rejected; token-count numeric limits remain independently enforced. Runner SHALL verify the producer digest from the complete received record before transformation and durable incorporation/acknowledgment. Equivalent serializations with identical canonical content SHALL NOT be treated as conflicting revisions. Evals SHALL preserve the digest/revision evidence but need not recompute hashes merely for valuation.

Shared compatibility fixtures SHALL provide original JSON, exact canonical bytes, and expected SHA-256 hashes covering fractional values, exponent notation, Unicode ordering and escaping, signed zero, and numeric limits, plus rejection cases. Consumers SHALL NOT substitute their language's default JSON reserialization for JCS.

#### Scenario: Cross-language representations yield the same record digest
- **WHEN** Validator and Runner canonicalize a shared record fixture containing fractional numbers, exponent spellings, and escaped Unicode under RFC 8785
- **THEN** both produce the fixture's canonical bytes and SHA-256 digest
- **AND** changes to canonical content under the same record/revision are diagnosed before acknowledgment

Export SHALL select a coherent committed generation and a bounded batch from the selected scope, with a durable opaque receipt covering exactly the returned identities, revisions, measurement versions, and payload digests. Select earliest pending revisions in stable commit order, with record type/ID/revision tie-breakers, within count/byte bounds; do not split records. Valid compatible pending evidence SHALL permit at least one returned record without materializing the whole backlog. `batch` SHALL state `generation`, `returned_revision_count`, `remaining_revision_count`, and `scope_complete` as of that generation. Every unreturned revision SHALL remain pending; a later head SHALL NOT implicitly release an earlier revision. A changed batch SHALL NOT reuse a receipt covering different revisions. Invalid/corrupt evidence SHALL yield explicit failure, not truncation presented as complete delivery.

Consumers SHALL drain by durably incorporating and acknowledging each batch, then exporting again; operators MAY explicitly discard a previewed batch instead. Export without disposition SHALL NOT advance a hidden cursor or consume evidence; it MAY return the same batch again. New recording or dispositions MAY change later batches. A scope-complete batch SHALL NOT promise no future revisions. Delivery gaps SHALL be reported through bounded summaries with counts, not unbounded historical payload/manifest lists.

`remaining_revision_count` SHALL count pending revisions omitted from the response; returned revisions remain pending until disposition. `scope_complete` SHALL be true exactly when that omitted count is zero, including an empty scope. Neither these counts nor batch completeness SHALL establish zero dispatch, successful acknowledgment, or absence of delivery gaps.

Invocation membership and attempt creation SHALL be committed coherently even when their delivery spans batches. Invocation measurement/finalization completeness SHALL remain distinct from delivery completeness. Consumers SHALL reconcile imported heads, expected attempt membership, batch coverage, and gaps before claiming complete delivery; one terminal invocation record or `scope_complete` alone SHALL NOT establish it.

#### Scenario: Both initial and final revisions remain pending
- **WHEN** an attempt's initial and terminal revisions have not been acknowledged
- **THEN** bounded exports deliver those pending revisions as updates to one attempt, each receipt identifying exactly its returned revisions
- **AND** the consumer can select the terminal revision without adding initial and terminal usage together

#### Scenario: Backlog exceeds one export batch
- **WHEN** a compatible pending scope exceeds a supported export count or byte limit
- **THEN** export returns a bounded nonempty batch and explicit remaining coverage instead of failing solely because the whole backlog is large
- **AND** acknowledgment or confirmed discard covers only that batch, leaving the rest retrievable for the next export

#### Scenario: Invocation and attempts span batches
- **WHEN** a consumer receives terminal invocation evidence while some associated attempt revisions remain in another batch
- **THEN** it retains incomplete delivery until imported evidence and coverage establish the expected attempt set without gaps

#### Scenario: Repeating bounded export without acknowledgment
- **WHEN** no recording/disposition changes occur and the caller repeats export with the same scope and limits
- **THEN** it receives the same selected revision set without consuming or skipping to later evidence

### Requirement: Idempotent and scoped acknowledgment

Validator SHALL provide a structured acknowledgment operation accepting an export receipt. A successful acknowledgment SHALL durably record receipt of only the covered revisions and MAY release their pending-delivery copies. It SHALL NOT delete newer or unrelated pending evidence or alter measured usage, validation outcomes, or ordinary snapshot/history retention.

Repeated acknowledgment SHALL be harmless. An invalid or mismatched receipt SHALL NOT release any pending evidence. If acknowledgment cannot be durably recorded, the operation SHALL report failure and preserve recoverability rather than report successful receipt.

Receipt payload pins SHALL be revision-specific. Once a covered revision has a durable acknowledgment or discard disposition through any valid receipt, it SHALL no longer remain pinned solely by any overlapping receipt. A fully disposed receipt SHALL retain only the small manifest/disposition metadata necessary for scope validation and idempotence, not require its payload files. Exporting a newer batch alone SHALL NOT release pending evidence. Independent active/latest-session and closure references MAY still retain the same payload.

#### Scenario: A newer receipt disposes evidence covered by an abandoned receipt
- **WHEN** R1 covers revision 1, R2 covers revisions 1 and 2, and the consumer durably incorporates and acknowledges R2 without acknowledging R1
- **THEN** neither payload remains retained solely by R1 after other retention references are gone
- **AND** a later R1 acknowledgment remains idempotent using retained metadata even after payload reclamation

#### Scenario: New export is not disposition
- **WHEN** R2 overlaps R1 but neither receipt has been acknowledged or explicitly discarded
- **THEN** all still-pending revisions remain protected and exportable

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

### Requirement: Bounded pending inventory and operator recovery

Validator SHALL provide `metrics pending` as a read-only, bounded inventory of contexts with pending evidence or retained discard gaps. It SHALL resolve the original project/configuration location without requiring the operator to know Runner's opaque context IDs, read private files, validate review definitions, or run validation. An optional consumer filter SHALL restrict the results.

Each page SHALL identify `store_id`, `inventory_generation`, `contexts`, and `next_cursor`. Context entries SHALL identify consumer/context, pending revision count, oldest pending timestamp when present, approximate retained payload bytes, and bounded delivery-gap counts/summaries without measurement payloads. Pages SHALL use deterministic consumer/context ordering and store/filter-scoped opaque position cursors. Each page SHALL reflect a committed generation; concurrent changes MAY require rescanning, and inventory SHALL NOT assert delivery completeness across generations. Missing storage SHALL be explicitly distinguished from an empty inventory. Inventory SHALL create no store, receipts, dispositions, or validation invocations.

Operators SHALL be able to discover a context, obtain a bounded export receipt, and explicitly discard that batch with `--confirm` without materializing the entire backlog. No receipt-free or broad purge operation SHALL be introduced. Discarded work SHALL remain a visible gap, not acknowledged work or zero consumption. Normal valid record sizes SHALL NOT make the only authorized discard route unreachable merely because the pending scope is large.

#### Scenario: Operator does not know pending context identifiers
- **WHEN** delivery has been broken across many Runner launches and the operator queries pending inventory using the original project/configuration
- **THEN** bounded pages expose the pending consumer/context IDs, counts, age, approximate bytes, and gap summaries without private-path discovery or mutation

#### Scenario: Operator discards a large backlog in previewed batches
- **WHEN** an inventoried context has more pending revisions than one export can return
- **THEN** the operator can preview and confirm discard of each bounded receipt in turn
- **AND** omitted/newer revisions remain protected until separately selected and confirmed, with each discarded batch leaving gap metadata

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

Explicit discard SHALL use `metrics discard` with the selected consumer/context, an export receipt, and `--confirm`. It SHALL release only still-pending covered revisions after committing their `user_discarded` delivery-gap disposition. It SHALL NOT expand to newer revisions or delete latest/historical measurement snapshots. Durable gap metadata SHALL identify the original scope and affected record revisions without retaining unrestricted provider payloads. Repeated discard SHALL not expand its original scope.

Acknowledgment and discard SHALL serialize their disposition changes: acknowledged revisions SHALL NOT later be relabeled discarded; discarded revisions SHALL remain visible as a delivery gap rather than being erased by a later acknowledgment. An acknowledgment covering discarded revisions SHALL report the gap instead of claiming complete acknowledgment.

#### Scenario: Explicit discard races with completion
- **WHEN** the user discards a receipt for an earlier revision while a newer completion is recorded
- **THEN** only still-pending revisions covered by that receipt are discarded and the completion remains exportable

#### Scenario: Acknowledgment and discard race
- **WHEN** acknowledgment and explicit discard target the same pending revision concurrently
- **THEN** their durable disposition changes are serialized and the first committed disposition is preserved
- **AND** discarded evidence cannot subsequently be represented as fully acknowledged delivery

### Requirement: Handoff failures are explicit and independent

Validation-time telemetry storage failures SHALL warn without changing validation outcomes or exit codes. Standalone snapshot publication and consumer delivery SHALL have independently observable states. Export or acknowledgment commands SHALL report their own operational failures through structured diagnostics and a failing command status, rather than return a successful empty measurement or acknowledgment. Such metrics-operation failures MUST NOT retroactively alter validation results.

Metrics errors SHALL distinguish retryable metadata contention/transient I/O from conditions needing configuration restoration, a compatible producer, or operator investigation of corrupt/conflicting committed evidence. The error SHALL identify whether retry is meaningful without that intervention. An archive-only recovery problem SHALL NOT be represented as corruption or unavailability of intact delivery records. No recovery path SHALL silently reset delivery state or infer zero from failed access.

#### Scenario: Committed delivery evidence is corrupt
- **WHEN** export cannot validate committed delivery metadata or record digests independently of any archive operation
- **THEN** it reports a non-retryable-without-intervention storage/conflict error and preserves the evidence for investigation
- **AND** it does not direct the consumer to run validation as a way to fabricate or clear the missing history

#### Scenario: Snapshot publication succeeds but export fails
- **WHEN** a validation snapshot exists but the consumer export operation cannot read or serialize the applicable evidence
- **THEN** export reports its failure without claiming zero usage or invalidating the recorded validation outcome

#### Scenario: Validation-time persistence fails
- **WHEN** telemetry persistence fails while validation is executing
- **THEN** validation continues with a warning and explicitly degraded telemetry state rather than claiming the evidence was durably retained

#### Scenario: Consumer cannot interpret the exported protocol
- **WHEN** Runner cannot support an exported protocol version and therefore does not acknowledge its receipt
- **THEN** Validator retains the unacknowledged evidence for subsequent compatible retrieval rather than treating export as delivery completion
