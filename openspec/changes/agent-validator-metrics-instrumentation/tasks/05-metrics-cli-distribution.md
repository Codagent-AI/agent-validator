# Task: Deliver bounded metrics retrieval, receipts and packaged Node contracts

## Goal

Ship the public, structured pull-and-acknowledge interface and its distributable schemas so consumers can discover, drain and explicitly discard retained batches without rerunning validation.

## Background

Paths under `src/`, `test/`, `docs/`, `contracts/`, and `.github/` are relative to the repository root. Definition references are relative to `openspec/changes/agent-validator-metrics-instrumentation/`. New metrics modules, contract assets, and `test/metrics/` are planned implementation paths, not claims that they already exist.

Read the approved `proposal.md`, the relevant sections of `design.md`, and `test-plan.md` (including Coverage Strategy and Completion and Evidence Boundaries), together with repository `AGENTS.md` and `test/AGENTS.md`. The verbatim specification requirements below are authoritative; the scope explanation identifies this delivery unit's portion where a requirement spans several boundaries.

This change implements Validator only. Preserve Validator measurement → Runner attribution/consolidation → Evals valuation ownership. Do not implement companion repositories, modify/regenerate the stopped evaluation artifact, introduce pricing/rate lookup, backfill from logs, or add a JSONL sink. Both companion reviews and the resolutions are approved; targeted confirmation of the revised contracts remains an implementation prerequisite, not a reason to repeat broad design review or claim interoperability passed. Track that prerequisite from `handoffs/agent-runner/handoff.md` and `handoffs/agent-evals/handoff.md`; these task files do not assert that confirmation has occurred.

Implement specification behavior with meaningful TDD and regression coverage. Use dependency injection, unique absolute temporary directories, restored child environments, and explicit synchronization barriers. Persistence/locking/termination checks use real filesystems and independent processes; failure injection supplements those checks. Use deterministic provider executables for all child calls including health/version probes, without real provider credentials or fallback to authenticated installed CLIs. Existing sanitized recordings must substantiate supported mappings; synthetic variations cannot establish provider accounting semantics. New live/paid captures are not authorized.

Source tests belong in the affected `test/metrics/`, `test/cli-adapters/`, `test/gates/`, `test/core/`, and `test/commands/` areas and run with `bun run test`. Built CLI tests belong in `test/integration/`, after `bun run build:npm`, and must be wired into `bun run test:e2e`, retaining its Docker coverage. Use an explicit Node executable with the absolute built `dist/index.js`; Bun's `process.execPath` is not Node coverage. Required build/runtime/assets must fail their designated check when absent, not silently pass. Run applicable lint/type checks as well. Automated filesystem/process evidence uses Linux CI; record runtime versions and filesystem context. No tests may clean/discard real project metrics or publish/install packages globally.

Do not execute `AT-*` or human acceptance as implementor work. Leave acceptance to the acceptance workflow, with accurate prerequisites and sanitized automated evidence. Producer tests do not establish actual Runner/Evals integration. No human-only flow is required. If full Validator review is explicitly requested during implementation, use `bun run build:npm && node dist/index.js run` from this checkout, never a Validator executable from PATH.

Register metrics commands through `src/index.ts` and `src/commands/index.ts`, with a new metrics command implementation under `src/commands/` and protocol/store operations under `src/metrics/`. Reuse the closed schemas, pure projections, recorder/store commit API and non-exiting run/check/review outcomes. Consult `src/config/loader.ts`, `loader-utils.ts`, `schema.ts`, `src/config/types.ts` and command configuration options; add a location-only resolver that does not call the full review loader. Tests belong in `test/commands/`, `test/metrics/`, `test/config/` and `test/integration/`.

Read design “CLI contract,” “Export, acknowledgment, and discard mechanics,” “Private storage, commits, and concurrency,” and version negotiation. Implement `metrics capabilities`, `pending`, `export`, `acknowledge`, and `discard` exactly with the approved options. `--project` defaults to cwd, relative explicit config resolves against project, default selection is `.validator/config.yml` then `.gauntlet/config.yml`; no config uses documented default location, malformed/unreadable location reports an error. Do not load review definitions, run Git/check/model work or create validation invocations. Capabilities is config-independent and creates no store. Inventory also creates no storage, receipts or dispositions.

Use one JSON stdout response on success and on argument/operational errors, safe diagnostics and nonzero failure status. Keep independent supported versions and exact error semantics (`unsupported_version`, `invalid_arguments`, configuration/storage unavailable or corrupt, `store_busy`, invalid receipt/scope, record conflict and `delivery_gap`). Distinguish retryable contention/transient I/O from intervention-required incompatibility/corruption/location restoration. Archive-only recovery issues cannot block intact delivery and cannot yield an instruction to run validation/clean.

Select, enforce and document concrete runtime values for the already-declared count/byte/individual-record bound fields, including inventory/export defaults and maxima; update packaged capabilities documentation and executable fixtures in `contracts/validator-metrics/v1/` to match those values. Selecting valid values for existing schema fields is not a schema-field addition or a schema-version change; each maximum valid record plus overhead must fit a supported batch. Inventory is deterministically consumer/context ordered, with store/filter-scoped opaque position cursors and per-page committed generation, counts/age/approximate bytes and bounded gap summaries. Missing storage differs from empty inventory. Avoid whole-backlog payload materialization; metadata index growth remains the documented trade-off.

Before any receipt, validate all pending scope measurement versions against producer/caller support; never silently filter unsupported revisions. Select earliest pending revisions by stable commit order and type/ID/revision tie-breakers within count/byte limits, without splitting a record. Export complete immutable replacements and digests, actual per-batch versions, original parent/context, generation/returned/remaining counts and `scope_complete`. Do not invent `context_records`. Empty, acknowledged, discarded and missing states cannot imply zero dispatch. Delivery completeness must reconcile imported parent membership/heads/batches/gaps independently of invocation finalization.

Commit an opaque immutable receipt binding store/scope/protocol/per-record versions/IDs/revisions/digests before response. Export alone consumes nothing. Under metadata coordination, acknowledgment commits exact dispositions before reclamation; older receipts cannot dispose newer updates. Discard requires an exported receipt and explicit `--confirm`, commits `user_discarded` gaps only for still-pending covered revisions, and preserves latest/history/unrelated evidence. First disposition wins across ack/discard races; a later ack cannot erase a gap. Repeated operations are idempotent even after payload collection. Disposition through any receipt releases overlapping delivery pins; small manifests/gap metadata remain, and active/latest/closure references can still pin payloads. Test the R1 rev1/R2 rev1+2 case and mixed dispositions without relying on abandoned receipts retaining payload forever. Keep metadata updates independent of closure journal parsing and merge current dispositions during any lifecycle writes.

Include `contracts/model-metrics/v1/` and `contracts/validator-metrics/v1/` in actual package output via `package.json`'s allowlist and `build.ts` as appropriate. Use local pack/extraction outside the source tree, not publishing/global install. Update `test/integration/helpers.ts` to provision explicit Node execution for new checks rather than treating Bun `process.execPath` or `isDistBuilt()` early return as a passing smoke. Wire package/schema/Node checks into `.github/workflows/validator.yml` and the release validation gate in `.github/workflows/publish.yml`/`docs/development.md` as appropriate; this authorizes test wiring, not running a release. Cover the declared minimum Node major (currently 18) and actual CI/release Node when different, without narrowing support to avoid failures. Keep existing Docker E2E coverage and release test requirements.

Document bootstrap/version negotiation, location recovery limits, bounded pending/export/save/ack drain, exact preview/discard, gap/error/retry handling and package contract discovery under `docs/` following its instructions. Preserve the approved boundary: Runner saves original mapping and incorporated evidence durably before ack; this change tests a controlled consumer, not Runner's implementation.

## Spec

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Versioned standalone artifact and invocation discovery

Agent Validator SHALL publish a machine-readable artifact at `<log_dir>/validation-metrics.json` containing explicit schema versioning, validation-session identity and state, command invocation records, model attempt records, and separate current-invocation and cumulative-session aggregates. Its measurement payload SHALL use the common versioned semantics shared with the consumer handoff; domain-specific outer artifacts need not have identical layouts or version numbers.

Structured validation results SHALL expose the command's `invocation_id`, its `session_id` when established, the artifact path when resolvable, and publication metadata that distinguishes a successfully published snapshot for this invocation from unavailable or stale evidence. A failed publication MUST NOT make an earlier snapshot appear to measure the current command. Session, invocation, and attempt records SHALL include lifecycle state and applicable timestamps; unobserved terminal times SHALL remain unavailable rather than invented.

#### Scenario: First invocation publishes its measurements
- **WHEN** the initial validation invocation records model attempts and snapshot publication succeeds
- **THEN** the artifact identifies that invocation and session, contains its attempt records, and exposes both invocation and session aggregates
- **AND** the structured result identifies the published artifact and its owning invocation

#### Scenario: Retry separates new work from session history
- **WHEN** another command invocation dispatches new reviews within the same open validation session
- **THEN** the artifact retains earlier invocation and attempt history
- **AND** its current-invocation aggregate includes only the later invocation's attempts while its session aggregate includes both

#### Scenario: Confirmed zero dispatch
- **WHEN** an invocation is confirmed to have dispatched no model and publication succeeds
- **THEN** its attempt set is empty and its model-consumption aggregate expresses confirmed zero dispatch
- **AND** no provider token observations or model attempts are manufactured

#### Scenario: Lock-rejected command does not replace the active snapshot
- **WHEN** another command owns the validation lock and the current command is rejected before dispatch
- **THEN** the rejected command's structured result identifies its own invocation and zero-dispatch outcome without mutating the active command's shared snapshot
- **AND** it does not claim that snapshot belongs to the rejected command

#### Scenario: Configuration or storage prevents publication
- **WHEN** configuration, session association, or storage cannot be established sufficiently to publish the current command's snapshot
- **THEN** the structured result explicitly identifies unavailable metadata and publication limitations
- **AND** an older snapshot is not presented as current-command evidence

The standalone artifact SHALL identify `artifact_schema_version`, `measurement_schema_versions` (the distinct versions of contained record heads), `aggregate_measurement_schema_version` (the root aggregate semantics), producer/version metadata, `snapshot_id`, `published_at`, `session`, `current_invocation_id`, invocation/attempt records, and separate `aggregates.current_invocation` and `aggregates.session`. Each invocation/attempt revision SHALL carry its own `measurement_schema_version`, preserved in the standalone artifact, storage, export, and digest input. Invocation-local aggregates SHALL follow that record's version. Initial artifact and measurement versions SHALL each be `1` and SHALL evolve independently of the export protocol and Runner's outer artifact. The common language-neutral schema and compatibility fixtures SHALL initially be owned and distributed by Validator; consumers SHALL pin reviewed versions rather than depend on Validator's implementation language.

Sessions and retained delivery scopes SHALL support records spanning producer/measurement upgrades without rewriting, dropping, or relabeling immutable earlier revisions. A version set or maximum version SHALL NOT imply a semantic conversion. New revisions MAY use a newer supported measurement version while retaining record identity; aggregate interpretation SHALL follow the explicit cross-version rules below.

#### Scenario: Retry after a measurement schema upgrade
- **WHEN** an initial failed invocation records measurement v1 and a retry in the same session records a later supported measurement version
- **THEN** each retained head identifies its actual measurement schema, and the snapshot lists the contained versions separately from the root aggregate version
- **AND** no historical revision is rewritten or mislabeled to force a single measurement version

Published telemetry schema versions SHALL define closed allowlists for their fields, nested objects, and source variants. Adding fields, including optional fields, SHALL require a new version of the owning measurement, artifact, or protocol contract. Already-declared optional fields MAY remain optional as specified. No opaque unknown-field forwarding or unrestricted extension object SHALL be required or permitted as a substitute for version agreement. Accepted evidence SHALL be preserved losslessly; unsupported fields or versions SHALL be explicitly rejected rather than silently dropped or interpreted as compatible evidence.

#### Scenario: A new telemetry field requires a new schema version
- **WHEN** a producer adds a field not declared by a published measurement schema, even if the field is optional
- **THEN** it identifies that field under a new measurement version rather than extending the old version's allowlist implicitly
- **AND** consumers lacking that version do not silently accept, drop, or forward the new field

Additive `RunResult.telemetry` metadata SHALL identify the invocation, explicitly available/unavailable session and artifact location, and publication state (`published`, `degraded`, or `unavailable`) with snapshot identity, owning invocation, and reasons. CLI consumers SHALL use the fixed snapshot's ownership metadata for standalone use or the consumer-scoped metrics export interface for integrated use; they SHALL NOT need console or `--report` parsing.

All three validation command executors SHALL return non-exiting structured internal/programmatic outcomes with this telemetry shape, including controlled errors before storage resolution. `RunResult.telemetry` is the run executor's surface; check/review result types SHALL expose the same shape. CLI wrappers SHALL preserve existing human output and exit behavior. This requirement adds no separate JSON console/failure transport and does not imply durable export where persistence was impossible.

#### Scenario: Snapshot exists but final publication is incomplete
- **WHEN** a current-invocation snapshot exists but recording or publishing terminal evidence fails
- **THEN** result metadata identifies degraded or unavailable final publication rather than claiming that the existing file establishes complete terminal evidence

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Allowlisted evidence and pricing independence

Durable measurement evidence SHALL be restricted to allowlisted identity, usage, timing, and provenance fields. Provider-native usage SHALL remain separate from normalized fields. Prompts, responses, credentials, environment values, and unrestricted provider event payloads MUST NOT enter the metrics artifact or handoff. Explanations of environment-conditioned collection limitations SHALL not expose the environment values themselves.

Account, user/principal, organization, email, and host/machine identifiers SHALL also be excluded, including from source metadata and diagnostics. Identity allowlists SHALL concern model identity and explicitly permitted opaque execution/session correlation; these correlation values SHALL NOT encode excluded identifiers. Necessary provider CLI session IDs and Validator-generated UUIDs MAY remain in their declared fields.

#### Scenario: Source event includes account and host metadata
- **WHEN** a source event contains valid usage together with account, user, organization, email, or host identifiers
- **THEN** the artifact and handoff retain only permitted measurements and opaque execution correlation, excluding those identifiers from fields and diagnostics

Provider-reported cost MAY be retained as source evidence with its provenance and applicable source semantics. Missing reported cost SHALL remain unavailable rather than zero. Validator SHALL NOT perform rate lookups, apply pricing tables, calculate estimated costs, or claim that token completeness establishes priceability. Downstream valuation SHALL not require rewriting the original measurement evidence.

Reported costs SHALL be represented as `provider_reported_costs[]` with stable attempt-local `cost_evidence_id` values, amount and currency availability, precision, source references, and explicit scope (`attempt`, `allocation`, or unavailable). Allocation-scoped cost SHALL reference a valid `allocation_id` in the same attempt revision. Each cost SHALL identify full, partial, or unknown coverage of that scope and established or unknown overlap relationships with other cost evidence. Neither an available amount nor attempt scope alone SHALL establish complete attempt cost. Empty cost evidence SHALL retain explicit availability/collection limitations, not imply free work.

Scoped evidence SHALL NOT expand to unrelated or unallocated work. Whole-attempt and allocation costs SHALL NOT be added as if disjoint without evidence. A later usage revision SHALL NOT silently inherit a complete cost-coverage claim if the retained cost no longer establishes coverage of that usage. Native currency SHALL be preserved, including explicit unavailable currency; USD reporting and any conversion remain downstream valuation policy. Validator SHALL retain cost evidence without calculating the combined estimated cost.

#### Scenario: Partial two-model allocation has cost for one allocation only
- **WHEN** one attempt observes models A and B, establishes total usage 150 with allocation A accounting for 100 and a defensible unallocated remainder of 50, and reports a cost only for allocation A
- **THEN** the cost references A's stable allocation ID and does not cover the unallocated remainder or the whole attempt
- **AND** the artifact preserves one dispatch, partial attribution, and incomplete attempt-cost coverage despite a known total-token count

#### Scenario: Whole-attempt cost overlaps allocation costs
- **WHEN** a source reports both a whole-attempt cost and costs for allocations included in that attempt
- **THEN** the evidence preserves their scopes and established overlap rather than presenting their sum as additional consumption

#### Scenario: Reported cost scope or currency is unavailable
- **WHEN** a source reports an amount without sufficient evidence of its currency or covered scope
- **THEN** Validator retains the safe amount evidence with explicit unavailable currency or scope rather than assuming USD or whole-attempt coverage

#### Scenario: New usage exceeds earlier cost coverage
- **WHEN** a newer attempt revision contains additional usage not covered by retained reported-cost evidence
- **THEN** the newer revision reflects partial or unknown coverage rather than retaining an unsupported complete-cost claim

#### Scenario: Provider event mixes usage with response content
- **WHEN** a provider event contains token usage and response text
- **THEN** only allowlisted measurement evidence is retained in telemetry and the response text is excluded

#### Scenario: Environment redirects collection
- **WHEN** caller configuration redirects or disables telemetry collection
- **THEN** the measurement explains the collection limitation without recording environment values or credentials

#### Scenario: Source reports no cost
- **WHEN** token usage is observed but the provider reports no cost
- **THEN** usage remains available and reported cost remains unavailable without a Validator-calculated estimate

#### Scenario: Total tokens are insufficient for pricing
- **WHEN** normalized total tokens are known but effective-model identity or needed billing categories are unavailable
- **THEN** those limitations remain visible and no priceability or cost-completeness claim is inferred from the total

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Lock Acquisition Before Console Logging
The `run`, `check`, and `review` commands MUST acquire the run lock before starting console logging. This ensures that failed lock acquisitions do not create orphaned console log files.

An invocation identity SHALL still be allocated for a lock-rejected command, and its structured result SHALL report its own `lock_conflict` and zero-dispatch outcome. It MUST NOT modify the active command's shared metrics snapshot or claim that snapshot as its own publication. Unestablished session association or unavailable publication SHALL remain explicit.

#### Scenario: Lock acquisition fails - no console log created
- **GIVEN** another validator run is in progress (lock file exists)
- **WHEN** the user executes `agent-validate run`
- **THEN** the lock acquisition SHALL fail with an error message
- **AND** no console log file SHALL be created
- **AND** the command SHALL exit with a non-zero exit code

#### Scenario: Lock acquisition succeeds - console log created
- **GIVEN** no validator run is in progress (lock file does not exist)
- **WHEN** the user executes `agent-validate run`
- **THEN** the lock SHALL be acquired first
- **AND** the console log file SHALL be created after lock acquisition
- **AND** the command SHALL proceed normally

#### Scenario: Lock conflict has independent invocation identity
- **WHEN** a concurrent command is rejected by the run lock
- **THEN** its result identifies a distinct invocation, the lock-conflict outcome, and confirmed absence of model dispatch
- **AND** the lock owner's snapshot and invocation identity are unchanged

Lock-rejected invocations SHALL be eligible for isolated consumer-scoped recording/export through a short telemetry metadata lock independent of the validation run lock. Isolated recording SHALL NOT update the active session association or latest snapshot. If it fails, the local result SHALL retain known invocation/dispatch facts and explicitly unavailable durable evidence; export SHALL NOT synthesize a persisted zero-dispatch marker from the failed write.

#### Scenario: Lock-rejected invocation is exported independently
- **WHEN** a consumer-correlated command loses the run lock but its isolated terminal invocation record is successfully persisted
- **THEN** its scoped export identifies `lock_conflict`, its own invocation ID, unavailable session association, and confirmed zero dispatch
- **AND** the lock owner's session snapshot is unchanged

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Invocation recording across all validation exits

Every `run`, `review`, and `check` execution SHALL receive its invocation identity before any early result can be returned. The invocation SHALL record its command, applicable session association, originating consumer context when supplied, status, timestamps, attempt set, and applicable aggregates/completeness. Controlled terminal paths SHALL finalize that invocation even when no review was dispatched, subject to explicit telemetry persistence limitations.

No changes, trusted reconciliation, no applicable gates, checks-only execution, configuration errors, and other pre-dispatch outcomes SHALL NOT reuse an earlier invocation's measurements. A failure before session or storage resolution SHALL still expose invocation identity and available facts in the structured result without inventing a durable artifact. Consumer export SHALL distinguish recorded zero-dispatch evidence from an invocation whose evidence could not be persisted.

#### Scenario: Trusted snapshot exits before gates
- **WHEN** reconciliation returns `trusted` without running gates
- **THEN** the command has a new invocation identity and a terminal zero-dispatch record when persistence is available
- **AND** existing trusted status and exit behavior are unchanged

#### Scenario: No changes or no applicable gates
- **WHEN** a validation command exits with `no_changes` or `no_applicable_gates` before model dispatch
- **THEN** its invocation records that outcome and an empty attempt set rather than presenting prior session usage as new work

#### Scenario: Checks-only command completes
- **WHEN** `check` executes shell checks but no model-backed reviews
- **THEN** the invocation records its actual validation outcome with zero model attempts rather than adding check activity as model usage

#### Scenario: Configuration error occurs before storage resolution
- **WHEN** a validation command fails to load usable configuration before telemetry storage or session association can be established
- **THEN** its structured error result retains its new invocation ID and known dispatch state with explicit unavailable session/publication metadata
- **AND** no earlier snapshot is claimed as evidence for that invocation

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Additive structured results and telemetry failure isolation

Structured validation results SHALL add invocation identity, established session identity, resolvable artifact location, telemetry publication/completeness metadata, and actual review-attempt references without changing existing validation-result fields or semantics. Validation status, exit codes, findings, retry behavior, console status/report behavior, and `--report` output SHALL remain compatible. Additional telemetry warnings SHALL not become review violations or change a passing validation to a failed validation or `passed_with_warnings` gate outcome.

Telemetry persistence/finalization failures SHALL be surfaced as warnings and explicit degraded metadata, not silently reported as successful durable publication. These warnings SHALL NOT prevent otherwise permitted validation or overwrite the original validation error. Metrics export/acknowledgment commands retain their own operational failure semantics as specified by `nested-metrics-handoff`.

#### Scenario: Validation passes but metrics publication fails
- **WHEN** all applicable validation work passes and telemetry publication fails
- **THEN** validation retains its passing status and existing exit code while surfacing a telemetry warning and unavailable/degraded publication metadata

#### Scenario: Validation fails and metrics finalization also fails
- **WHEN** a gate fails and recording terminal telemetry fails independently
- **THEN** the original validation failure remains authoritative and the telemetry failure is reported separately

#### Scenario: Existing report consumer runs validation
- **WHEN** a caller uses `run --report` with telemetry enabled
- **THEN** existing report content and exit semantics remain compatible and the caller is not required to parse added telemetry from report text

#### Scenario: Programmatic caller receives measured review results
- **WHEN** model reviews execute and structured results are returned
- **THEN** the result includes invocation/session/publication metadata and actual attempt references in addition to the existing gate result information

`RunResult.telemetry` SHALL expose the additive identity, location, and publication fields specified by `validation-metrics`, with independent history and delivery diagnostics. Validation-command invocation allocation SHALL precede controlled configuration and context-file errors. Controlled command helpers SHALL return their outcomes to a finalization owner before CLI process exit. No metric-operation invocation SHALL be confused with a validation-command invocation.

The run, check, and review executors SHALL all return non-exiting structured internal/programmatic results carrying the common telemetry metadata. Only CLI wrappers SHALL format the existing output and choose process exit behavior. Controlled pre-storage errors SHALL retain invocation identity and known facts in those results; when no evidence could be persisted, CLI export SHALL report missing/unavailable delivery rather than invent a marker. This SHALL NOT add a second machine-readable console/failure transport.

#### Scenario: Check and review return controlled error outcomes
- **WHEN** a programmatic caller invokes the check or review executor and configuration, context-file, or lock handling fails in a controlled way
- **THEN** the executor returns its structured outcome and telemetry metadata without terminating the caller's process
- **AND** the corresponding CLI wrapper preserves the existing validation error and exit semantics

#### Scenario: Context file cannot be read
- **WHEN** a validation command encounters a controlled context-file read error before adapter dispatch
- **THEN** it retains its own invocation identity, known zero-dispatch state, original validation error, and explicit persistence/publication availability
- **AND** finalization occurs before the command exits without changing the existing validation exit semantics

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Independent protected delivery retention

Ordinary cleanup and historical rotation SHALL preserve private pending-delivery evidence and the lifecycle/receipt state needed to export and acknowledge it safely. This preservation SHALL apply at every historical retention depth and to manual and automatic cleanup, including existing context-change cleanup. Resetting validation execution state SHALL NOT discard another session's pending measurements.

Only acknowledgment of the applicable exported revisions or explicit user-directed discard SHALL permit release of pending delivery evidence as specified by `nested-metrics-handoff`. A receipt for an earlier revision MUST NOT release a later update during concurrent cleanup. The latest snapshot, historical copies, and pending evidence SHALL remain distinct retention concerns: retaining one is not proof that another was delivered.

Private storage paths remain an implementation detail; a hidden filename by itself is not a preservation guarantee. These requirements do not protect against external deletion or disk loss.

#### Scenario: Historical session is evicted before acknowledgment
- **WHEN** ordinary archive rotation evicts a session with unacknowledged measurements
- **THEN** the historical copy may be removed but the pending evidence and required delivery state remain retrievable through Validator's metrics CLI

#### Scenario: Context change resets execution state
- **WHEN** existing validation policy cleans logs and resets execution state because the project context changed
- **THEN** pending measurements retain their original session and consumer context and are not discarded by that reset

#### Scenario: Cleanup overlaps acknowledgment of an older revision
- **WHEN** cleanup occurs while a receipt for an earlier attempt revision is acknowledged and a newer revision remains pending
- **THEN** the newer revision remains exportable and the combined operations do not acknowledge or delete it

#### Scenario: Ordinary cleanup cannot serve as explicit discard
- **WHEN** the user invokes ordinary cleanup rather than the explicit discard operation
- **THEN** pending delivery evidence remains protected and no successful-delivery or user-discard assertion is recorded

## Test Plan

Own INT-003's complete parser/resolver/store/consumer protocol boundary, INT-006 distribution and E2E-003's built public journey. Use the actual recording commands for zero-dispatch and isolated lock rejection; use real store operations and a durable test consumer for batch/replay/race tests. Reuse INT-005's corpus for lossless supported fields, rejection before receipts, digest conflicts, mixed versions, optional fields, stable allocations/costs and privacy canaries from adapter fixtures.

At the store reference boundary test overlapping-receipt reclamation using supported lifecycle/reference operations, not manual deletion or alteration of private records. INT-003's mandated repeat through normal archive/close transitions becomes executable with the production close coordinator; retain that specific integration supplement in the cleanup delivery unit, with no claim here that injected closure state proves the final lifecycle. Similarly test independence from a marked closing session here, and require crash-at-every-archive-phase public retrieval proof at the coordinator boundary. All other INT-003 cases, including bounded draining and discard, execute here.

From the approved `test-plan.md`, retained verbatim:

### INT-003: Metrics CLI, configuration resolution, and receipt transactions

- Covers: All NH retrieval/scope/revision/acknowledgment/failure requirements; RL “Lock Acquisition Before Console Logging” and “Invocation recording across all validation exits.”
- Boundary: Metrics command parser → lightweight location resolver → real store/metadata lock → controlled durable consumer.
- Setup: Temporary projects with default/legacy/explicit configuration selection, invalid review definitions with valid location configuration, two consumer contexts, a live validation lock owner, and prepared/terminal revisions. The controlled consumer durably writes received records and outstanding receipts in its own temporary files; it is not a substitute for actual Runner integration acceptance.
- Action: Query capabilities; export/re-export; crash the consumer before saving and after durable save but before acknowledgment; retry acknowledgments; acknowledge an older receipt after a new revision; race acknowledgment with receipt-scoped confirmed discard; test invalid/mismatched receipts and failed disposition persistence. Exercise missing/acknowledged/discarded contexts, unsupported versions/fields, malformed arguments, original-location unavailability, and bounded metadata contention.
- **Bounded-operation cases:** Create enough contexts/revisions to exceed advertised inventory count and export count/byte limits. Discover them with filtered/unfiltered `metrics pending` pages without private-path knowledge. Check cursor store/filter validation, generation reporting during concurrent changes, no storage/receipt mutation, and missing-store versus empty inventory. Drain each context through bounded export/save/ack batches, and a separate context through previewed confirmed discard batches. Test maximum valid record fit, excessive requested limits, repeat export without disposition, gaps larger than one summary, and recording during drain. Record-payload handling must remain batch-bounded, not materialize all payloads before slicing; retained metadata-index size is a separate documented storage trade-off.
- **Receipt-reclamation cases:** Export R1 for prepared revision 1, then R2 for revisions 1+2; durably incorporate/ack R2 but abandon R1. After active/latest/closure references are removed through normal test-owned lifecycle transitions, assert payload files are reclaimable despite R1, and retry R1 after reclamation. Repeat with discard and mixed dispositions, preserving gap responses. Repeat cycles to show disposed payload copies do not accumulate solely because of overlapping receipts; small manifest/disposition metadata is intentionally retained. A newer export without disposition must release nothing.
- Assertions: One structured stdout JSON response with correct operation/version/error semantics; no checks, models, or new validation invocations from metrics commands. Invalid review definitions do not prevent location-only retrieval. Context isolation and original attribution hold. Export does not consume; only durable receipt disposition releases eligible revisions. Older receipts cannot release newer records; duplicate acknowledgment is harmless; discard leaves a gap and preserves unrelated/newer evidence. No silent schema downgrade, field dropping/forwarding, or acknowledgment of unsupported evidence. Zero dispatch is a recorded invocation fact, not an empty result. Lock-rejected invocation export is isolated and does not replace the lock owner's snapshot. Failures distinguish retryable contention from intervention-required delivery corruption/configuration/version problems.
- **Batch assertions:** Each receipt covers exactly its returned version-tagged revisions; unreturned evidence remains pending. Counts and `scope_complete` describe the selected generation, not future finalization. An invocation delivered before its associated attempts is not fully delivered merely because it is terminal. The consumer combines original parent IDs and already incorporated evidence without `context_records`, never sums revisions, and exposes missing parent/history evidence as gaps. A large valid backlog remains operable without broad purge or receipt-free deletion.
- **Constraints:** Synchronize races at the transaction boundary. A simulated consumer proves Validator's contract only; Runner's own save/ack implementation is separately obligated in INT-005 and AT-003.
- Execution: Command/store integration tests in `test/commands/` and `test/metrics/` via `bun run test`; use real CLI subprocesses for parser/stdout/process-exit assertions in `test/integration/` after building.

From the approved `test-plan.md`, retained verbatim:

### INT-006: Packaged contracts and Node CLI runtime

- Covers: VM “Versioned standalone artifact and invocation discovery”; NH “Validator-owned metrics retrieval interface”; design contract distribution and portability commitments.
- Boundary: Build/package allowlist → local install/extraction → Node CLI and distributed schemas/fixtures.
- Setup: Build this checkout with `bun run build:npm`; create a local package in a unique temporary directory without publishing. Use an explicit Node runtime within the declared support range; the compatibility smoke must include the declared minimum Node major as well as the CI/release Node runtime when different. Use cached/local dependencies or normal CI installation prerequisites, not paid services.
- Action: Inspect the actual package contents; run its CLI capabilities and representative metrics operations against a test project; load the distributed schemas and fixture manifest outside the source tree.
- Assertions: Required contract assets are actually packaged and resolve without source-tree imports. Advertised versions match shipped schemas. Node execution emits valid structured output and does not accidentally depend on Bun-only runtime APIs. Missing build/runtime/assets fail the designated check rather than silently skipping. No package publication or global installation occurs.
- **Constraints:** The current package allowlist and test helper do not themselves prove these obligations: contracts must be included during implementation, and spawning Bun's executable is not a Node smoke test. Test capability behavior on no project configuration without creating a telemetry store.
- Execution: `test/integration/` distribution smoke, after build, within the existing E2E CI phase with necessary Node runtimes provisioned. The release validation gate must include the package-content and Node checks; this does not authorize a release.

From the approved `test-plan.md`, retained verbatim:

### E2E-003: Zero-dispatch and early-error command contracts

- Covers: RL “Invocation recording across all validation exits,” “Lock Acquisition Before Console Logging,” and “Additive structured results and telemetry failure isolation”; VM invocation discovery; NH zero versus missing evidence and structured CLI failures.
- Surface: Built `run`, `check`, `review`, and metrics commands under Node.
- Setup: Isolated projects providing representative no-change/trusted/no-applicable-review and checks-only outcomes; a controlled lock-owning process; invalid configuration/context-file cases. No provider process may perform model work in this journey.
- Journey: Execute the representative zero-dispatch and controlled early-error paths through command entry points, then retrieve scoped invocation evidence when persistence was possible. Corresponding integration tests invoke each non-exiting run/check/review executor and inspect its structured result on pre-storage configuration/context-file/lock errors; a returned result must not terminate the host process. Built CLI wrappers separately prove unchanged output/exit behavior. Do not expect an added JSON failure transport on validation stdout.
- Assertions: Each controlled validation command receives its own invocation identity and correct unchanged outcome/exit semantics. Persisted zero-dispatch commands have terminal invocation evidence without manufactured model attempts. A lock-rejected invocation does not replace the owner's snapshot or create a console log. Persistence/configuration failure does not claim an old snapshot or fabricated durable marker; export reports missing/unavailable evidence distinctly. Metrics parser errors produce structured JSON and never invoke validation. Existing `--report` behavior stays compatible.
- Execution: Representative command cases in `test/integration/`, included in `bun run test:e2e`; exhaustive controlled-outcome integration coverage belongs in INT-001/003 and existing core/command tests, not a combinatorial E2E matrix.

## Done When

- INT-003 protocol/resolver/receipt cases pass with bounded real store/consumer subprocess coverage, exact retained revisions and dispositions, no unsupported evidence acknowledgment, and one structured response even on malformed CLI arguments.
- E2E-003 passes through the built Node CLI and corresponding non-exiting executor tests; zero dispatch, missing delivery, early failures, isolated lock rejection and unchanged `--report` behavior remain distinct.
- INT-006 passes against actual locally packed/extracted contracts and explicit supported Node runtimes, with required assets/runtimes failing when absent. CI and release gates run these checks and retain existing E2E/Docker coverage; no package is published.
- Inventory/export operate within advertised payload bounds and preserve maximum-size valid record operability, count/generation semantics, all unsupported required-version errors before receipts and gaps without broad purge.
- Receipt tests establish disposition-based overlapping-pin release and idempotence after payload reclamation. Record the production-closure supplement as pending until exercised through the close coordinator; it is not waived.
- The delivered public-export supplement to INT-004 passes using the adapter fixtures: private/principal/host canaries are absent while permitted model/correlation evidence survives. The real mixed-version retention/export supplement to INT-005 passes against the shared corpus; pure projections alone are not its completion evidence.
- Public documentation explains original-location requirements, durable save-before-ack, bounded operator recovery, structured errors, version compatibility and independent measurement/delivery completeness.
