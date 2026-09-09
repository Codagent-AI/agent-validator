## Context

Agent Validator currently returns review text from `CLIAdapter.execute()`. Several adapters already parse usage but reduce it to human-readable log lines. `invokeAdapter()` in `src/gates/review-runtime-helpers.ts` is the common review-dispatch boundary. Review interpretation, mutable review JSON, command results, and log cleanup have separate lifecycles. In particular, `runStreamingCommand()` can reject on timeout before process-close handling, and its cleanup callback can remove adapter evidence before failure telemetry is extracted.

`executeRun()` centralizes most `run` outcomes, while `executeGateCommand()` and its support helpers contain independent `check`/`review` exits. Configuration and context-file errors can precede those executors. `cleanLogs()` currently rotates paths without a recovery transaction and returns early when ordinary current logs are absent. These boundaries all need instrumentation; adding a final JSON write to the success path is insufficient.

The approved ownership boundary is Validator measurement → Runner workflow attribution/consolidation → Evals valuation/reporting. The existing Runner JSONL sink is not the target contract. This change implements only Validator. Runner and Evals implementations, and any modification or regeneration of the stopped evaluation artifact, are out of scope. Both companion agents reviewed the contract. Their consequential findings were assessed with the user, who approved the recovery/digest and allocation/cost/schema-evolution resolutions recorded here. Those revisions still require targeted interoperability confirmation and executable fixtures; review feedback is not completed integration acceptance.

All current planning artifacts remain in this change directory. Source/module and distribution paths below describe future implementation, not files scaffolded during design.

## Goals / Non-Goals

Goals:

- One durable, deduplicable measurement per actual adapter dispatch, including failed and interrupted work.
- Distinct validation session, command invocation, dispatch attempt, provider session, and consumer correlation identities.
- Honest identity, token accounting, provenance, uncertainty, and independently typed aggregates.
- A standalone latest snapshot and a lossless, non-consuming CLI export with revision-bound acknowledgment.
- Recoverable cleanup and pending delivery independent of historical retention.
- Compatible validation findings, scheduling, retry policy, console/report text, and exit codes.

Non-goals:

- Pricing, model rate lookup, or declaring unknown usage to be zero.
- A second JSONL delivery transport, a metrics service, SQLite, or a shared runtime dependency across languages.
- Backfilling older runs from console logs or modifying old eval evidence.
- Migrating legacy log-based reports such as `review-audit` or `newsletter-metrics`. Document that these are outside the new measurement contract and its accuracy guarantees; specifically, `review-audit` currently zero-fills missing token fields. Direct machine consumers to the new contract, not these legacy reports.
- Automatic relocation of telemetry when its storage is moved/deleted externally or configuration changes its location.
- Exactly-once transport. Delivery is replayable; consumers achieve idempotent incorporation using producer record identities and revisions.

## Approach

### Components and boundaries

| Component | Responsibility | Principal integration points |
| --- | --- | --- |
| Measurement contract and pure reducers | Validate allowlisted evidence, normalize with explicit relationships, derive typed aggregates | New `src/metrics/` domain modules; no orchestration or pricing dependencies |
| Adapter collectors | Capture source evidence, versions, partial failures, and review text separately | All six `src/cli-adapters/` implementations and streaming helpers |
| Invocation/attempt recorder | Allocate identities, associate context, commit revisions, preserve degradation | `run-executor`, gate-command executor, `Runner`, review dispatch helpers |
| File-backed telemetry store | Atomic commits, immutable revisions, receipt/disposition state, independent metadata lock | Private storage under the resolved log directory |
| Snapshot publisher | Derive and atomically publish the latest session view | `<log_dir>/validation-metrics.json` |
| Close coordinator | Persist closure plan, isolate file moves, recover rotation and session boundary | `commands/shared.ts`, manual clean, `skip`, existing automatic-clean callers |
| Metrics CLI | Capabilities, pending inventory, bounded scoped export, acknowledgment, explicit discard | New command registration in `src/index.ts`; lightweight configuration resolver |

```text
run / check / review → invocation recorder → actual adapter dispatch
                                ↑                   │
                                └── safe evidence ──┘
                                         │
                               committed record revisions
                                  /                \
                      standalone snapshot      scoped CLI export
                                                     │
                                      Runner durable incorporation
                                                     │
                                           CLI acknowledgment
                                                     │
                                         Runner artifact → Evals
```

Review text remains in the existing review pipeline. Telemetry never derives from the text emitted by Validator's console formatter. Provider CLI output may itself be a supported source, but its adapter parser must extract an allowlisted measurement structure before persistence.

### Contract versions and ownership

Start the new contracts at independent integer version `1`:

- `measurement_schema_version`: the common measurement and aggregate semantics.
- `artifact_schema_version`: Validator's standalone session snapshot.
- `protocol_version`: Validator's metrics operations and export records.
- `capabilities_version`: the small bootstrap capabilities response.
- `storage_version`: private on-disk layout, never a consumer parsing requirement.

These numbers do not inherit versions from Runner's previous bridge or workflow artifact. Runner chooses its own outer artifact migration. Validator initially owns the language-neutral JSON Schemas and compatibility fixtures. During implementation, distribute them with the Validator source/package under `contracts/model-metrics/v1/` and `contracts/validator-metrics/v1/`; no TypeScript runtime dependency is required by Go or JavaScript consumers. Consumers pin a reviewed schema version and fixture revision. Schemas and runtime validators must be tested for agreement.

Telemetry schemas are closed within a published version: supported fields, nested object shapes, source variants, and enums are explicitly allowlisted. Adding telemetry fields, including optional fields, requires a new version of the owning contract. Measurement changes increment `measurement_schema_version`; transport/record-envelope changes increment `protocol_version`; standalone-root changes increment `artifact_schema_version`. Existing optional fields may be present or absent as their fixed schema permits. No opaque extension bag or arbitrary provider-native property forwarding is introduced. A schema-defined typed map may carry only the keys/value variants its version explicitly permits.

Consumers validate the applicable versions and closed schemas, preserve all accepted evidence losslessly, and reject unsupported fields/versions without acknowledgment rather than dropping or forwarding them blindly. Capability negotiation must establish supported versions; do not relabel new evidence with an older version to force compatibility. Common measurement changes require review from both companion owners. This replaces the earlier same-version optional-addition/unknown-field-forwarding policy. These artifacts define the first, unreleased version 1; the approved pre-release clarifications do not imply a previously shipped v1 requiring migration.

Every immutable invocation/attempt revision carries its own `measurement_schema_version`, including in the hashed record and standalone arrays. This selects the schema for that revision's measurement and aggregate semantics. Producer upgrades can leave several measurement versions in one session or pending scope; neither upgrade nor export rewrites or relabels old evidence. A new revision may use a newer version while keeping its record identity. Export accepts a repeatable `--measurement-version` option declaring the caller's supported set and returns `measurement_schema_versions`, the actual distinct versions in that batch. Before issuing any receipt, check compatibility for all pending revisions in the selected scope; unsupported retained versions produce `unsupported_version` with the required set, not a filtered apparently complete delivery. The outer protocol version describes the response/envelope, never the meaning of all nested measurements by implication.

The standalone root declares `measurement_schema_versions` for its contained record heads and `aggregate_measurement_schema_version` for its newly derived root aggregates. Invocation-local aggregates follow their containing record's version. Reducers use explicitly reviewed cross-version semantic mappings; compatible values may contribute with source-version provenance, while incompatible or unsupported contributions remain identifiable coverage limitations or separate semantic groups. Never fall back to an older compatible revision when the current head cannot be interpreted. Retain the original heads and mark affected aggregate fields partial/unavailable instead. A version list or maximum version is not a conversion rule.

### Record model

IDs are collision-resistant UUIDs allocated by Validator. `invocation_id` exists before controlled command errors or early returns; `attempt_id` is allocated immediately around an actual `adapter.execute()` call. Session association is established only after startup reconciliation and any context-change closure. A lock-rejected invocation has no invented session association.

Every exported record has this envelope:

| Field | Meaning |
| --- | --- |
| `record_type` | `invocation` or `model_attempt` |
| `record_id` | Invocation ID for invocation records; attempt ID for attempt records |
| `revision` | Positive integer, increasing for changes to this record |
| `measurement_schema_version` | Schema selecting this revision's measurement/aggregate semantics; retained across storage, snapshot, and export |
| `producer` | `name`, implementation `version`, explicitly available/unavailable `build_revision` |
| `consumer_context` | Original `{ consumer, context_id }`, never the context doing recovery; null for standalone uncorrelated records, which are not part of scoped consumer export |
| `payload` | Complete replacement record at this revision, not an additive usage delta |

Each immutable revision carries `digest: { algorithm: "sha256", canonicalization: "rfc8785", value: <lowercase hexadecimal SHA-256> }`, used by storage and export manifests. The hash input is the UTF-8 output of the [RFC 8785 JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785.html) applied to the entire record envelope and payload, excluding only its top-level `digest` member. This is not the output of an arbitrary language's JSON serializer. JCS defines number serialization, UTF-16 code-unit property ordering, and string escaping; it preserves array order and does not normalize Unicode. Reject duplicate object names, invalid Unicode, and non-finite numbers. Exact token integers remain subject to the contract's safe numeric range; safe native evidence requiring greater precision must use an explicitly typed string rather than silent rounding.

Validator computes and verifies stored record digests. Runner must recompute and verify each received record before transformation, durable incorporation, and acknowledgment, retaining all contract-permitted fields in the hash input. It must not hash a flattened local model or drop fields first. Evals preserves the producer digest/revision and measurement evidence through Runner's artifact; recomputing digests is not a prerequisite merely to price that evidence. A digest is an integrity/conflict check, not authentication of the local producer.

Producer-issued `(record_type, record_id, revision)` identifies a revision; distinct canonical content claiming that identity is corruption/conflict, not another contribution. Equivalent JSON serialization spellings that canonicalize identically are not conflicts. `store_id` identifies a storage instance for protocol scope and receipts, not a replacement for the globally unique producer IDs. A copied record does not become new work because its storage location changed.

Invocation payloads contain `invocation_id`, typed `session_id`, command, original consumer context, lifecycle state, actual validation outcome, start/end times, elapsed duration, attempt IDs, dispatch-state evidence, independent completeness, and typed aggregates. An in-memory attempted dispatch remains in the final invocation's attempt set even if its individual write failed; the finalization then advertises the missing persisted evidence. Confirmed zero requires terminal invocation evidence establishing no dispatch, not an empty file or failed write.

Attempt payloads contain `attempt_id`, `invocation_id`, typed `session_id`, gate/job, review slot, log-derived run/retry context, adapter, lifecycle state, dispatch state, execution outcome, review outcome, timestamps/duration, and `measurement`. Execution failure, invalid review output, review violations, and collection limitations are separate fields. Provider CLI session IDs belong to source identity evidence and are not Validator session IDs.

Lifecycle state is `prepared`, `running`, or `terminal`; recovery can establish `interrupted` when the owner is known dead. A prepared record after an uncontrolled interruption proves a dispatch was prepared, not that the subprocess necessarily started or that zero tokens were consumed. Its dispatch state remains `unknown` unless persisted evidence establishes more. Terminal end time is null with a reason when not observed; recovery time is not substituted for execution end time. New retries always allocate new attempts.

### Measurement shape and accounting

The common `measurement` object contains:

- `identity.requested`, `identity.resolved`, and `identity.observed` (an array of observed model identities with stable attempt-local `identity_id` values). Identity fields use `{ state: available | unavailable, value, provenance, reason }`. Requested and resolved identity never fill an observed field. Empty observed identity includes an explicit limitation. An identity ID identifies an evidence entry, not proof that every provider/model/effort field is available.
- `versions.adapter_name`, `versions.parser_mapping_version`, `versions.cli_version`, and `versions.source_format` with format name and available/unavailable event version. Producer version/build is retained in the enclosing record. A parser mapping version is an implementation-owned identifier, not a guessed provider version.
- `sources`: bounded, typed, allowlisted native usage/identity/timing/version observations with stable local source references. Provider-native category names and values remain separate from canonical tokens. No general-purpose provider event object or exception serialization is accepted.
- Evidence identity means model identity and explicitly permitted opaque execution/session correlation, not principals. Account, user, organization, email, and host/machine identifiers are excluded from every telemetry surface, including source fields and diagnostics. Opaque execution IDs must not encode those identifiers; producer-generated UUIDs and needed provider CLI session IDs remain permitted within their explicit schema fields.
- `tokens`: every canonical field (`input_total`, `input_uncached`, `cache_read`, `cache_write`, `output`, `reasoning`, `provider_total`) plus `normalized_total`, each using the envelope below.
- `allocations`: `per_model` entries, an `unallocated` entry when established, `per_model_attribution: complete | partial | unavailable`, and explicit relationships to the parent measurement. Each represented allocation has a stable attempt-local `allocation_id`, measurement envelopes, source references, and an available/unavailable `observed_identity_ref` to an `identity_id` in this attempt. Unallocated evidence has no invented exact-model link; the observed identity set remains context, not an allocation of its tokens. These are views of the attempt's usage, not more attempts.
- `provider_reported_costs`: an array of scoped source-evidence entries as defined below, never locally calculated costs. Empty entries are accompanied by explicit reported-cost collection/availability reasons, not interpreted as zero cost.
- `completeness`: independent history, source collection, canonical coverage, identity coverage, total coverage, per-model attribution, and reported-cost availability/collection dimensions; no single Boolean stands for all of them.
- `diagnostics`: bounded codes and allowlisted field/source references, not raw stderr, prompts, errors containing provider payloads, or environment values.

A token envelope has `state: available | partial | unavailable`, `value` (known value/subtotal or null), `origin: observed | derived | unavailable`, `precision: exact | approximate | unavailable`, `source_refs`, `derivation` (identifier and input references, or null), `relationships` (known inclusion/non-overlap or explicitly unknown), and `reasons`. `partial` means the numeric value is a known subtotal, not a complete value. Approximation is independent: a fully collected rounded value can be `available` and `approximate`. Unavailable fields always have null values and a reason. Known zero is available zero.

Allocation and identity IDs are assigned when their evidence entry is first established and retained across revisions/replay; array order and mutable model labels are not identifiers. A revised count for the same source-supported allocation retains its ID; a distinct allocation gets a new ID. An ID must not be repurposed for a different source scope/model. References resolve within the same complete attempt revision; retaining an ID does not assert that coverage remains complete when new usage arrives. The recorder/collector carries these IDs through updates rather than regenerating them on snapshot/export. Missing allocation identity evidence remains unavailable, not a guessed model. Numeric unallocated remainders still require proven subtraction/non-overlap.

Each `provider_reported_costs` entry has a stable attempt-local `cost_evidence_id`, typed available/unavailable `amount` and `currency`, source references, precision, and `scope: { kind: attempt | allocation | unavailable, allocation_id, reason }`. `allocation_id` is required and must resolve in this revision for allocation scope; it is null for attempt/unavailable scope. Unknown scope or currency retains the reported evidence with an explicit reason. Cost coverage states `full`, `partial`, or `unknown` relative to that scope in this revision, with supporting source references and known or unknown inclusion/non-overlap relationships to other cost evidence. Scope alone is not a completeness claim: an attempt-scoped running subtotal can still be partial.

Whole-attempt costs and allocation costs may overlap and must not be added indiscriminately. Costs cover only their established scope/coverage. Multiple allocation costs can support a full downstream amount only when coverage of all relevant work is established without overlap; otherwise they support only a known subtotal. If a later revision expands usage without matching cost evidence, cost coverage must reflect that limitation. Amount precision, cost coverage, model attribution, and token completeness remain independent. Provider-native currency is preserved; USD reporting or currency conversion is Evals policy, not Validator normalization. No provider-reported amount is relabeled an Evals estimate.

Representative fixture: one attempt observes A and B and establishes total usage 150; allocation `alloc-a` links to A and reports 100, while `alloc-unallocated` retains the defensible remainder 50 without claiming it belongs to B. A reported cost of 0.01 USD references only `alloc-a` with full allocation coverage. The dispatch count is one, attribution is partial, and that cost does not establish complete attempt cost. A second fixture carries both an attempt-wide cost and allocation costs with explicit overlap, ensuring consumers never sum both views.

Relationship entries identify a containing field or a disjoint field and whether the relationship is established or unknown. Parser mapping identifiers establish source-specific formulas. Derivation is restricted to reviewed formulas, not evaluation of arbitrary strings. A complete total can be derived from established complete input/output populations even when the reasoning breakdown is absent; unknown category overlaps prevent unsupported breakdowns or totals. Never derive uncached input as total minus cache-read if an unknown cache-write category may also be included. Never add reasoning again when it is included in output.

Source parsers distinguish deltas, per-request values, and cumulative counters; cumulative counters and request events describing the same work must not both contribute. Unknown reset/deduplication semantics prevent a completeness claim. Counts must be finite and nonnegative; exact integer token counts must be safely representable across the supported JSON consumers. Invalid or out-of-range values yield normalization diagnostics and unavailable affected fields; safe original scalar evidence can remain in `sources` without being treated as valid normalized usage.

### Aggregates and standalone snapshot

Aggregate envelopes contain `state`, `known_subtotal`, `precision`, `coverage` with known eligible/contributing/partial/missing attempt IDs and whether the population is complete, and `reasons`. No known numeric contribution yields null, except a proven empty population which yields a complete zero aggregate without fabricating provider observations. Available approximate contributors make an approximate aggregate. Missing history or values prevent a complete total even when a subtotal exists.

Reducers select each distinct attempt's latest revision once, including failed attempts, subject to the explicit cross-version interpretation and coverage rules above. They do not add revisions, raw observations, model allocations, invocation aggregates, or session aggregates to attempt totals. Incomparable provider-total semantics are kept in explicit semantic groups; a number that cannot be meaningfully combined is not promoted to a complete cross-provider total. Unknown identities and unallocated usage retain their own groups. A conflicting same-revision payload degrades affected views and raises a diagnostic.

The standalone root fields are `artifact_schema_version`, `measurement_schema_versions`, `aggregate_measurement_schema_version`, `producer`, `snapshot_id`, `published_at`, `session`, `current_invocation_id`, `invocations`, `attempts`, `aggregates.current_invocation`, `aggregates.session`, and `diagnostics`. Session state is active/closing/closed with timestamps and history coverage. Invocation and attempt arrays contain their latest committed version-tagged revisions. A snapshot only includes its session; older pending delivery remains in private retention. Summed attempt duration is labeled `attempt_work_duration_ms`, never elapsed time. Session/invocation elapsed time uses observed boundaries, with unavailability when needed.

An additive `RunResult.telemetry` object exposes `invocation_id`, typed `session_id`, typed `artifact_path`, and `publication: { state: published | degraded | unavailable, snapshot_id, owner_invocation_id, reasons }`, plus separate history and delivery diagnostics. A previously written file is not proof of this invocation's successful final publication. A partial current snapshot is `degraded`, not a fully successful final publication. Existing review results add `attempt_id` only for actual dispatches, or explicitly historical references for preserved results. Existing result fields and `--report` text remain unchanged; Runner obtains machine data through the metrics CLI rather than requiring a new console/report parser.

### Adapter integration and finalization

Change the adapter result to `{ text, telemetry }` and use a typed execution failure carrying safe partial `telemetry` plus the original operational error for the existing review error path. The error itself is never persisted in metrics. Use an optional evidence-update callback to persist validated partial observations at meaningful source-event boundaries; do not write a revision for every output chunk.

The shared dispatch wrapper registers the attempt and parent membership atomically before calling the adapter when storage permits. It commits execution telemetry on success/failure, then attaches the separately determined review outcome from `evaluateOutput()` and subsequent existing review handling. Invocation finalization waits for all controlled attempt finalizations. A crash between execution completion and review interpretation retains the already observed usage and an unavailable review outcome.

Streaming helpers collect/drain available evidence before destroying temporary sources, settle only once, and preserve the original timeout/error category. Cancellation uses bounded final collection: a hung provider is not allowed to hold validation open indefinitely just to collect telemetry. Late callbacks cannot overwrite a terminal state. SIGKILL cannot be made graceful; already committed evidence is the recovery floor. No extra model request is made to discover versions or recover usage. CLI-version discovery is bounded and cached within an invocation; discovery failure is explicit unavailability.

Pass the producer attempt ID into collection setup. Allocate a uniquely owned source file/directory for each dispatch, including same-adapter calls in the same clock tick; PID plus timestamp alone is insufficient. Use a location allowed by the provider sandbox, and delete only that attempt's owned sources after extraction. Shared sources require source-supported per-attempt correlation; ambiguous or cross-contaminated observations cannot support complete usage and leave affected measurements partial/unavailable. Test parallel identical-timestamp launches with distinct counts and overlapping cleanup, not merely distinct record IDs.

| Adapter | Existing source to integrate | Conservative mapping obligation |
| --- | --- | --- |
| Codex | Structured JSONL completion usage | Establish per-turn vs cumulative semantics, input/cache inclusion, and actual identity evidence; do not treat a CLI turn count as proven provider request count |
| Claude | Existing OTel metric/request extraction | Verify overlap between counters and request events; preserve redirected/disabled collection limitations |
| Gemini | Existing temporary OTel output | Isolate the sink per attempt and read before its own cleanup; establish counter reset/overlap and identity support from representative output |
| GitHub Copilot | Human-readable usage summary and model rows | Preserve rounding as approximate and actual row allocations only; retain evidence even on model-mismatch errors |
| OpenCode | Structured step-finish usage | Verify field inclusion and aggregation across events before claiming normalized totals |
| Cursor | Current CLI output, without an established usage parser | Explicit unsupported/unavailable fields until representative evidence supports a mapping |

This table describes implementation starting points, not a claim that all source semantics are already verified. Recorded, sanitized representative output and field-level support documentation are implementation acceptance requirements. Synthetic fixtures alone cannot establish a provider guarantee. Unrecognized sources remain partial/unavailable.

The minimum useful producer acceptance bar is evidence-backed canonical `input_total` and `output` usage for both Codex and Claude on representative successful dispatches, with defensible accounting relationships and declared precision. This does not require every category, effective identity, or failure path to be complete; those retain honest limitations. Other adapters remain subject to the support matrix and evidence rules. An all-unavailable implementation does not meet acceptance. Use existing sanitized recordings where available; missing evidence blocks that mapping's acceptance rather than lowering this floor. New paid/live captures still require separate authorization. Whether actual Claude output overlaps is settled by recordings, not assumed from the current parser alone.

### Command orchestration

Allocate the invocation at the validation-command boundary, before configuration/context-file handling. All three command executors (`run`, `check`, `review`) expose non-exiting structured internal/programmatic results with the common additive telemetry metadata; `RunResult.telemetry` remains the run result surface, and gate-command result types carry the same telemetry shape. Refactor controlled early exits, including configuration/context-file/lock helpers, into returned outcomes handled by one finalization owner. Only the CLI wrappers format existing output and select the existing exit behavior. Pre-storage errors remain visible in those structured results without inventing durable records; CLI integrations still use metrics export and report a delivery gap if persistence was impossible. No new JSON console/failure transport or report parsing is introduced. Unknown-command/help parsing is not a validation invocation.

Preserve existing run-lock acquisition before console logging. A lock-rejected command may commit its isolated invocation record through the separate telemetry lock, with unavailable session association and terminal zero-dispatch evidence. It cannot update the active session pointer or latest snapshot. If even isolated persistence fails, the result reports known zero dispatch locally and unavailable durable evidence; export cannot manufacture a marker for it.

Under the run lock, recover pending closure, perform existing startup context reconciliation/cleanup, then establish or join the active telemetry session. Trusted/no-change and other early paths still finalize their own invocation without inventing attempts. At existing terminal clean triggers, finalize attempts and invocation before materializing session closure; hold the run lock through ordinary cleanup. Manual clean acquires the same run lock. Export/acknowledgment never acquire that long-lived lock.

Route every existing cleanup caller through the close coordinator: manual clean, `skip`, run/check/review success, retry-limit, and context-change cleanup. Resolve `max_previous_logs` once from the loaded project configuration and pass it explicitly to closure; use the schema default only when configuration omits it. In particular, do not preserve the current gate-command call that loses configured depth. `skip` closes an active telemetry session before advancing the baseline, using the same pending-evidence protection as clean; it creates neither a validation invocation nor a model attempt. The next validation belongs to a new session. A metrics-only closed-session archive consumes one ordinary rotation slot at nonzero depth; depth zero creates none and leaves existing archives untouched.

### Private storage, commits, and concurrency

Use immutable JSON revisions and atomic metadata replacement, not SQLite. Proposed private layout:

```text
<log_dir>/
  validation-metrics.json
  .metrics/
    store.json                 # storage version and store identity
    state.json                 # committed generation, record heads, scope/disposition indexes
    records/<record-id>/<revision>.json
    receipts/<receipt-id>.json # immutable exact revision/digest manifest
    closures/<close-id>/       # journal and transaction-specific staging
    metadata.lock             # short-lived interprocess lock
```

The entire `.metrics` directory and fixed snapshot are explicitly excluded from current-log, rerun, run-number, previous-failure, rotation, and recursive deletion predicates. Being hidden is not the protection mechanism. Existing protected execution/debug/lock files remain protected too.

All record-head, invocation-membership, receipt, acknowledgment, discard, and lifecycle metadata changes take the short telemetry lock. The lock has owner PID and nonce; do not steal a live lock solely because it is old. Stale recovery verifies the dead owner and matching ownership token. Lock acquisition is bounded: validation warns/degrades on telemetry-lock failure, whereas metrics operations fail explicitly. Lock order is run lock then telemetry lock when both are needed; metrics operations never wait for the run lock. No metadata lock is held during a model process or bulk archive movement.

Within a commit, write new immutable revisions to same-filesystem temporary files, flush and close them, rename to final unique paths, then atomically replace the metadata commit root referencing them. Sync files and relevant directory entries for the supported local filesystem durability path. A failed required flush/commit must not be reported as durable success. Orphan files written before a failed commit are not exported as committed records. Parallel writers reread the latest metadata under the lock, preventing lost updates. An in-process queue reduces lock churn but does not replace interprocess coordination.

Only successfully committed evidence is promised to survive managed cleanup. Preserve valid evidence when metadata is corrupt; do not silently initialize an empty complete history over a damaged store. Validation can continue with isolated/in-memory telemetry and explicit unavailable session/history. Metrics operations return a specific storage error when committed delivery state itself is inaccessible or invalid; unfinished closure alone is not such an error. Unsupported private versions are not destructively reset.

Committed delivery records, receipt manifests, and their disposition indexes remain independently readable and writable while any closure phase is unfinished. The metadata commit root exposes a valid committed delivery generation even when its session is closing. Export/acknowledgment read that generation and do not require parsing or replaying the unfinished archive journal, publishing a latest snapshot, or acquiring the validation run lock. Their own bounded metadata-lock acquisition handles provably stale lock owners. A later snapshot/closure update must merge the latest delivery dispositions under the metadata lock rather than restore a frozen pre-acknowledgment index. No subsequent validation or clean invocation is necessary to retrieve and acknowledge committed evidence.

Garbage collection uses committed references: active/latest-session evidence, pending consumer revisions, outstanding receipts, and closure manifests pin what they need. Acknowledgment/discard releases delivery retention only, not active/session/snapshot retention. Durable small receipt dispositions and context delivery/gap markers remain so repeated operations and previously delivered contexts remain distinguishable from zero dispatch. No automatic TTL evicts pending records. Non-consumer history can be released after replacement/closure when no retained view needs it; immutable archived snapshots are self-contained.

Receipt payload pins are revision-specific and last only while the covered revision lacks a committed acknowledgment/discard disposition. A disposition committed through any valid receipt releases that revision's delivery pins from all overlapping receipts. Once all covered revisions are disposed, a receipt retains only its small immutable manifest and disposition metadata for scope validation/idempotence; re-acknowledgment must not require reclaimed payloads. Another export alone never supersedes a pending revision or releases its pins. Materialized response bytes remain valid even if a concurrent disposition makes disk copies eligible for collection. For R1 covering revision 1 and R2 covering revisions 1+2, acknowledging R2 leaves no payload retained solely by R1; unrelated active/latest/closure references can still retain it. Small metadata is deliberately retained, not a promise of constant total store size.

### CLI contract

Runner generates a globally collision-resistant opaque context ID and durably stores its mapping to workflow run, execution session, and original parent step attempt before launching:

```text
agent-validator run --metrics-consumer agent-runner --metrics-context <context-id>
```

`check` and `review` accept the same paired flags. Context is correlation, not a storage path or a provider session. Validator validates bounded nonempty identifiers and stores them as values; it never interpolates untrusted context into filesystem paths. Reusing a context may select several invocations, but it cannot collapse their identities. Runner normally allocates a new context per shell execution and retains the prior mapping for recovery.

```text
agent-validator metrics capabilities
agent-validator metrics pending --project <dir> [--config <file>] --protocol-version 1 [--consumer <name>] [--after <opaque-cursor>] [--limit <count>]
agent-validator metrics export --project <dir> [--config <file>] --consumer <name> --context <id> --protocol-version 1 --measurement-version 1 [--measurement-version <another-supported-version>] [--max-records <count>]
agent-validator metrics acknowledge --project <dir> [--config <file>] --consumer <name> --context <id> --protocol-version 1 --receipt <opaque-token>
agent-validator metrics discard --project <dir> [--config <file>] --consumer <name> --context <id> --protocol-version 1 --receipt <opaque-token> --confirm
```

`--project` defaults to cwd; relative `--config` is resolved against that project. Without it, use the same `.validator/config.yml` then legacy `.gauntlet/config.yml` selection as validation. Resolve `log_dir` and its type without loading gates, requiring adapters, or running Git/check/model work. If there is no configuration, only use the documented default location; do not search arbitrary directories and infer zero from missing storage. A malformed/unreadable location configuration returns an explicit error. Keeping the original project and configuration selection available is Runner's responsibility. Changing `log_dir` or removing/moving the store is not automatic migration; unsuccessful lookup remains missing/unavailable evidence, never zero. Runner does not need any private metrics filename.

Every metrics command emits one JSON object to stdout, with diagnostics in the object and optional human diagnostics only on stderr. No interactive prompts occur. `discard` requires explicit `--confirm`; export is the preview of its exact scope. Capabilities is a read-only, config-independent response with `capabilities_version`, producer metadata, supported `protocol_versions`, `measurement_schema_versions`, `artifact_schema_versions`, and supported operations.

Capabilities also advertises the protocol's inventory/export count defaults and maxima, byte budgets, and maximum individual record size. These bounds are enforced and documented with the executable schemas; the maximum valid record plus response overhead must fit a supported export batch. Neither inventory nor export requires reading an entire backlog of record payloads into memory; the metadata index can still scale with retained history as described in the storage trade-offs. An excessive caller limit is `invalid_arguments`, not silent widening. Normal valid retained records must remain exportable one bounded batch at a time.

`metrics pending` provides read-only operator discovery without knowing Runner's opaque contexts. It resolves location like other data commands but accepts an optional consumer filter, not a required context. Each bounded page returns `store_id`, `inventory_generation`, `contexts`, and `next_cursor`. Entries identify consumer/context, pending revision count, oldest pending timestamp, approximate retained payload bytes, and a delivery-gap count/summary without measurement payloads or unrestricted diagnostics. Include scopes with pending evidence or retained discard gaps. Ordering is deterministic by consumer/context; the opaque `--after` cursor is scoped to store/filter and encodes position, not a private path. Each page reflects its own committed generation; concurrent changes can require a fresh scan, so this is an operational inventory, not proof of delivery completeness. Missing storage is explicit, not an empty complete inventory. No inventory operation creates storage, receipts, validation invocations, or dispositions.

Operational responses include `protocol_version`, producer metadata, `operation`, `ok`, and `diagnostics`. Errors use `ok: false`, an `error` containing stable `code`, safe `message`, and `retryable`, and exit code 1. Codes include `unsupported_version`, `invalid_arguments`, `configuration_unavailable`, `storage_unavailable`, `storage_corrupt`, `store_busy`, `invalid_receipt`, `scope_mismatch`, `record_conflict`, and `delivery_gap`. There is no generic `recovery_required` response directing the caller to run validation or clean. Unsupported-version errors advertise supported versions without pretending to have serialized the requested version. Metrics CLI parsing errors must use this structured error path too. Success exits 0. Validation command exit codes remain independent.

`store_busy` is retryable metadata contention; retrying the same metrics operation requires no validation. Incompatible storage needs a compatible producer; inaccessible configuration or permissions need restoration of that original context; corrupt committed delivery metadata/records or conflicting digests need operator investigation/restoration rather than automatic destructive repair. Those unresolved conditions are not retryable without a relevant change. Temporary storage I/O errors may be retryable when established as transient. Error messages identify the action needed without exposing secrets. An unfinished or conflicting archive-only journal may be reported as a closure diagnostic but cannot prevent export/acknowledgment of independently valid delivery evidence.

An export response additionally includes `measurement_schema_versions`, `store_id`, `consumer_context`, `export_id`, `evidence_state`, `records`, `batch`, `delivery_gaps`, and `receipt`. `evidence_state` is `pending`, `previously_acknowledged`, `discarded`, or `missing`; mixed pending/gap cases use `pending` with explicit gap details. Successful lookup of no matching invocation returns `missing` and null receipt, not confirmed zero. A finalized invocation with no attempts is a real invocation record in a pending batch. There is no `context_records` field in v1: records are complete replacements with original parent identities, and Runner retains already incorporated evidence. A batch need not repeat acknowledged parents; missing required parent evidence in the consumer remains a gap, not fabricated context.

Export drains a scope through bounded batches. `batch` contains `generation`, `returned_revision_count`, `remaining_revision_count`, and `scope_complete`; remaining/count completeness is as of the selected committed generation, not a promise that no future revisions can arrive. Select the earliest pending revisions in stable commit order, with record type/ID/revision as tie-breakers, until count or byte limits are reached; never split a record. Return at least one when compatible valid pending evidence exists. A receipt covers only the returned records. The consumer saves and acknowledges each batch, then exports again to drain the remainder; an operator can instead explicitly discard that exact batch and repeat. No export cursor or whole-context materialization is needed. Without disposition, repeat export may repeat the same batch and never implicitly advances it. Concurrent recording/disposition may change the next batch. Delivery-gap output uses bounded summaries with counts rather than embedding unbounded historical manifests; inventory also exposes these gaps.

`remaining_revision_count` counts pending revisions omitted from this response; returned revisions remain pending until disposition. `scope_complete` is true exactly when that omitted count is zero, including an empty scope, but neither true nor zero counts establish zero dispatch, successful acknowledgment, or absence of delivery gaps.

### Export, acknowledgment, and discard mechanics

Export takes the telemetry lock, selects a committed metadata generation and a bounded subset of pending revisions for the requested scope, validates/digests the selected records, materializes its batch, and commits a receipt manifest before responding. Version compatibility is checked for the pending scope before selection as described above. All revisions are complete replacements; a batch can contain both prepared and terminal revisions or deliver them in separate batches. Every unreturned revision remains pending, including older revisions; newer heads never implicitly release them. Runner applies revisions in order or selects the newest, never sums them. Invocation membership and attempt creation are committed together, but batching can separate their delivery. An invocation's terminal/complete measurement state is not proof that the consumer has imported its whole attempt set. Runner must reconcile batch coverage, parent membership, imported heads, and gaps before claiming complete delivery. Missing writes remain explicit history gaps.

The opaque receipt is a random identifier for an immutable server-side manifest binding store, protocol and per-record measurement versions, consumer/context, and the exact returned record IDs/revisions/digests. It contains no caller-controlled path. Identical pending batches may reuse the existing manifest; a changed batch receives another receipt. Export materializes the bounded response and commits revision-specific pins before releasing the lock; the response remains valid if later disposition permits collection of disk copies. Receipt payload pins follow the disposition-based lifecycle above, not perpetual retention of every exported copy. Repeated export does not consume delivery. Receipt possession is not a remote authorization system; these are same-user local CLI operations with explicit scope validation.

Acknowledgment validates the requested scope and complete manifest, then atomically records dispositions for exactly the covered revisions before releasing delivery references. A receipt for revision 1 has no effect on revision 2. Deleting eligible copies happens only after that durable state change and is retryable; failure to reclaim disk is not failure to incorporate an already committed acknowledgment. A crash before the state commit leaves evidence pending; a crash after it permits an idempotent repeated acknowledgment. Lost responses are recovered by retrying the same operation.

Discard uses a valid export receipt and the same serialized disposition transaction. It affects only still-pending covered revisions, commits a durable gap marker with original context/record revisions and reason `user_discarded`, then permits release of their delivery copies. It does not delete standalone/latest/history measurements or newer revisions. No broad purge operation is introduced. Concurrent acknowledgment and discard resolve under the lock: already acknowledged revisions are not relabeled discarded; already discarded revisions remain a visible gap and a later acknowledgment cannot erase that fact. Acknowledgment of a receipt containing discarded revisions reports `delivery_gap` rather than claiming complete acknowledgment. Repeated discard reports its existing disposition without expanding the scope. Gap markers themselves do not contain review/provider payloads.

### Recoverable session closure

Closure is a recoverable multi-file transition, not a claim that all log files change atomically at once. The snapshot alone has atomic reader visibility.

1. Under the run lock, finalize the current invocation and attempts where possible. Freeze the session's as-of-close committed revision set and allocate a `close_id`.
2. Under the short telemetry lock, commit a closure intent containing that session, snapshot digest, explicitly resolved project retention depth, explicit ordinary-log inventory, archive inventory, and transaction-specific staging destinations. Mark the session `closing` so no later invocation can join it. Recovery uses that frozen depth, not a helper's default or later changed configuration.
3. Materialize the immutable closed-session snapshot in closure staging. At nonzero depth, stage ordinary current files and the existing archive directories at unique transaction-owned paths before installing the new archive and shifted retained archives. At depth zero, delete only the inventoried ordinary files and leave all preexisting historical directories untouched; no new archive is installed.
4. Journal phase progress. Each rename has unique source/staging/destination identity and recoverable pre/postconditions. Recovery distinguishes a completed move from a missing/conflicting file; it does not rerun the old rotate loop against already shifted `previous.N` paths. Delete evicted staged archives only after their disposition is durably established.
5. Atomically publish the fixed latest snapshot with the same as-of-close measurements. Persist the closed session boundary and completion of the transaction. Keep the closed latest snapshot until a later publication replaces it; pending delivery remains independent.

Archive staging stays on the same filesystem under the protected private directory. Archive metadata identifies the transaction/session so a crash after archive installation but before progress recording is recognized as completion of that operation. Existing legacy archives receive transaction identity metadata for movement; their existing measurements are not rewritten. Recovery reconciles recorded identities and explicit inventory, never a fresh wildcard sweep. Unexpected external modification or ambiguous state yields a diagnostic, not an overwrite/deletion guess.

Archive/session closure recovery occurs under the run lock before new session association and normal log writing. This is separate from delivery access: metrics export and acknowledgment operate on committed delivery evidence without completing closure or taking the run lock. A known closing session is never reopened. If storage errors prevent safe closure recovery, leave protected evidence intact, skip unsafe replay, and continue permitted validation with unavailable/degraded telemetry association instead of blocking it or guessing complete history. Any later retry of journal operations must validate the frozen file identities so newer logs cannot be mistaken for the earlier inventory. The same warning policy applies if no durable closure intent can be written; no fully durable close is claimed. This failure path preserves validation's existing outcome, not a guarantee that broken storage can be repaired automatically.

An active session with no ordinary logs still closes and produces one metrics-only archive consuming one normal rotation slot when retention is nonzero. This applies to `skip` as well as other cleanup callers. Depth zero creates none. A repeated clean with only a closed snapshot/pending delivery is a no-op. When ordinary pre-instrumentation logs require cleanup without a known telemetry session, rotate them under the existing retention policy without inventing an old session's complete measurements. Existing `.execution_state` preservation/reset rules remain unchanged.

## Decisions

- **Immutable JSON plus recovery journal over SQLite:** Fits the existing portable Node/Bun distribution and review-scale workload without a native database dependency. SQLite would simplify metadata transactions but not remove the need to coordinate external log rotation. The file approach requires explicit crash and lock tests; atomic rename alone is not the whole design.
- **Pull and acknowledge over push JSONL:** Validator owns storage discovery, retained evidence, coherent export, and receipt validation. Runner owns durable incorporation and original workflow mapping. This avoids exposing private paths and prevents an empty/deleted sink from standing in for zero consumption. There is one integration transport, not two partially overlapping ones.
- **Common semantics, distinct outer artifacts:** Validator owns the initial closed schemas/fixtures; Runner and Evals pin reviewed versions. New fields require the relevant version bump. This accepts more coordinated upgrades in exchange for enforceable allowlists and prevents lossy translation without forcing all repositories into one runtime or packaging system.
- **Attempts are authority, revisions replace:** Invocation/session summaries and allocations are deterministic views. This makes retries, multi-model work, and recovery deduplicable without a cost-specific producer model.
- **Fail-open validation, explicit metrics errors:** Telemetry cannot change validation status. Conversely, a metrics operation must not return success for failed export/acknowledgment or silently convert missing evidence into zeros.
- **Exact receipt-scoped release:** This is more stateful than a high-water mark, but it makes concurrent finalization, acknowledgment, and explicit discard unambiguous without assuming ordered delivery.

## Risks / Trade-offs

- File transaction complexity is concentrated in one store/close coordinator. Require fault injection around every durable boundary and tests using independent processes, not only mocked promises.
- Pending delivery and small disposition markers can grow while consumers remain broken. This is deliberate; surface scope/count diagnostics and provide explicit receipt-scoped discard rather than silently evict evidence.
- Bounded inventory and receipt-scoped export batches make a backlog operable without broad purge authority. They add batch-coverage obligations to Runner; test draining, replay, and finalization split across batches. Small disposition metadata remains retained, so this is bounded payload processing, not an unbounded-scale telemetry service or constant-size index guarantee.
- CLI/provider telemetry varies by version and configuration. A documented unsupported field is acceptable; unsupported completeness, guessed identity, or invented allocation is not.
- Original project/configuration availability is required for recovery. Storage relocation, external deletion, and filesystems without the expected durable atomic operations are not silently repaired or claimed safe.
- Refactoring gate-command early exits and process finalization risks changing validation behavior. Preserve regression fixtures for statuses, report text, lock conflicts, retry limits, one-shot preservation, and cleanup triggers.
- Sibling review may reveal contract issues. Those findings must be assessed with the user before changing approved behavior; compatibility is not established merely because this design is written.

## Verification Strategy

1. Contract fixtures: language-neutral cases for observed/derived/approximate/unavailable counts, overlapping categories, unknown cache-write, effective-identity gaps, multiple/unallocated models, provider cost, and typed partial aggregates. Standalone and export projections must preserve the same measurement evidence.
2. Pure-domain tests: deterministic deduplication and revisions; reject same-revision conflicts; no adding raw/normalized/allocation views; zero-population vs unknown population; comparability and aggregate coverage; summed work vs elapsed time.
3. Adapter tests: sanitized recorded representative output for every supported mapping, including failure/truncation/timeout, source version changes, redirected collection, metric/request overlap, and secret/prompt canaries excluded from durable telemetry. Unknown formats cannot pass as complete.
4. Lifecycle tests: all controlled exits in `run`/`check`/`review`, configuration/context-file failures, isolated lock rejection, parallel reviews, real retries, preserved reviews, and interruption before/after dispatch and finalization. Existing outcome/report/scheduling tests must remain unchanged in meaning.
5. Store/cleanup tests: process crashes before/after revision and state commits, every archive staging/installation phase, snapshot publication, and close-boundary commit; repeated recovery; conflicting external files; no-log closure; depths 0/1/3 and missing intermediate archives; pending delivery survives every managed cleanup path.
6. Protocol tests: capabilities and unsupported versions; malformed args/receipts; lightweight retrieval despite invalid review definitions; scope isolation; prepared→terminal export race; save-before-ack replay; acknowledgment-write failure; stale receipt; concurrent discard/ack; gap persistence; structured errors with no JSON stdout contamination.
7. Companion acceptance: Runner and Evals validate common fixtures in their own languages before implementation is accepted. Runner must durably map launch context and incorporate evidence before acknowledgment. Evals must preserve evidence and price only semantically supported usage. End-to-end recovery must count the original attempt once under the original step, and distinguish zero work from missing/discarded delivery.

The approved Runner-review fixes add two mandatory obligations: (a) crash at each closure phase after delivery commits, then export and acknowledge using only metrics commands, with no subsequent validation or clean; later closure recovery must preserve those acknowledgments; (b) shared original JSON, exact JCS canonical bytes, and expected SHA-256 fixtures for fractional provider-cost values, exponent forms, signed zero, Unicode ordering/escaping, safe integer boundaries, rejected out-of-range token counts, and malformed input. Runner verifies the fixtures in Go and Validator in its supported runtime; same-value alternate serializations agree and changed canonical content is rejected. These obligations are recorded in the approved [test plan](test-plan.md) and do not claim tests were run during planning.

The approved Evals-review fixes add fixtures for stable allocation/identity/cost joins across revisions, two-model partial allocation with allocation-only cost, multiple cost scopes with overlap, unavailable currency/scope, and usage revisions outgrowing earlier cost coverage. Contract tests must preserve every accepted schema-defined field, including already-defined optional fields, and reject undeclared fields/unsupported versions without acknowledgment. They must not test opaque unknown-field forwarding as a desired behavior. Runner's companion tests select one current head per producer attempt while retaining revision/digest/attribution/gaps; Evals' tests separate dispatch count from per-row participation, preserve unknown cache-write, and distinguish known cost subtotal from exhaustive non-overlapping coverage.

The approved approach-review resolutions additionally require mixed measurement-version records/snapshots/batches with explicit aggregate mappings, overlapping-receipt payload reclamation, bounded pending inventory and batch draining/discard, same-tick source isolation, the complete cleanup-caller/depth matrix including `skip`, non-exiting structured outcomes for all three executors, and personal/account/host canaries. Codex and Claude evidence-backed input/output usage is a producer acceptance floor. Legacy log-based reporting is expressly outside this migration's accuracy claims. These are additions to the test plan, not executed evidence or authority for paid captures.

Use the repository's Bun test conventions and Node distribution smoke tests. Full Validator execution, when explicitly requested during implementation, must build this checkout and run `bun run build:npm && node dist/index.js run`, not a potentially unrelated executable from PATH. Planning verification does not require live paid model calls.

## Migration Plan

1. Both read-only companion reviews have been received and their resolutions approved by the user. Return the targeted revisions via the handoffs for interoperability confirmation; agree the versioned shapes and fixture obligations before implementation. Do not describe either review as unconditional integration acceptance.
2. Implement Validator contracts, pure reducers, store/recovery, CLI, lifecycle integration, and adapters in separately planned tasks. Produce the schemas and representative/compatibility fixtures described here. Existing logs without metrics remain explicitly unmeasured; do not backfill from console output.
3. Accept Validator producer behavior and document per-adapter support and unavailable fields. Producer acceptance is not end-to-end integration acceptance.
4. Integrate Runner in its own change: pin contract, replace its old sink expectation, migrate native measurements to common semantics, persist original context mappings, export after all outcomes and during recovery, durably consolidate, then acknowledge. Unsupported/older producers remain explicit gaps rather than triggering direct snapshot scraping.
5. Integrate Evals in its own change: accept the reviewed Runner artifact version, retain uncertainty and attribution, support multi-model/unallocated evidence, and separate pricing policy from measurement. Verify the complete route, including failure and replay, before claiming complete nested eval costs.

Implementation can overlap after contract agreement, but acceptance proceeds Validator → Runner → Evals. Do not have an older Validator binary operate on the new protected telemetry store without a compatibility check: its cleanup code does not know the new exclusions. Rollback must preserve/export pending evidence and keep telemetry-aware cleanup, or use an isolated log directory; deletion/reset of pending evidence is not an automatic rollback step.

## Open Questions

No user-facing architecture choice remains deferred within this design. Targeted confirmation of the revised cross-repository contract, executable compatibility fixtures, and evidence-based adapter mapping validation remain required work, not already completed integration acceptance or provider guarantees. Runner's internal recovery scheduling/artifact migration and Evals' valuation/report representation are owned by their companion changes.
