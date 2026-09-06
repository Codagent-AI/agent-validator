# Task: Define versioned measurement contracts and deterministic projections

## Goal

Deliver an independently testable, language-neutral measurement foundation that preserves identity, uncertainty, accounting relationships, and revision integrity in both standalone and export representations.

## Background

Paths under `src/`, `test/`, `docs/`, `contracts/`, and `.github/` are relative to the repository root. Definition references are relative to `openspec/changes/agent-validator-metrics-instrumentation/`. New metrics modules, contract assets, and `test/metrics/` are planned implementation paths, not claims that they already exist.

Read the approved `proposal.md`, the relevant sections of `design.md`, and `test-plan.md` (including Coverage Strategy and Completion and Evidence Boundaries), together with repository `AGENTS.md` and `test/AGENTS.md`. The verbatim specification requirements below are authoritative; the scope explanation identifies this delivery unit's portion where a requirement spans several boundaries.

This change implements Validator only. Preserve Validator measurement → Runner attribution/consolidation → Evals valuation ownership. Do not implement companion repositories, modify/regenerate the stopped evaluation artifact, introduce pricing/rate lookup, backfill from logs, or add a JSONL sink. Both companion reviews and the resolutions are approved; targeted confirmation of the revised contracts remains an implementation prerequisite, not a reason to repeat broad design review or claim interoperability passed. Track that prerequisite from `handoffs/agent-runner/handoff.md` and `handoffs/agent-evals/handoff.md`; these task files do not assert that confirmation has occurred.

Implement specification behavior with meaningful TDD and regression coverage. Use dependency injection, unique absolute temporary directories, restored child environments, and explicit synchronization barriers. Persistence/locking/termination checks use real filesystems and independent processes; failure injection supplements those checks. Use deterministic provider executables for all child calls including health/version probes, without real provider credentials or fallback to authenticated installed CLIs. Existing sanitized recordings must substantiate supported mappings; synthetic variations cannot establish provider accounting semantics. New live/paid captures are not authorized.

Source tests belong in the affected `test/metrics/`, `test/cli-adapters/`, `test/gates/`, `test/core/`, and `test/commands/` areas and run with `bun run test`. Built CLI tests belong in `test/integration/`, after `bun run build:npm`, and must be wired into `bun run test:e2e`, retaining its Docker coverage. Use an explicit Node executable with the absolute built `dist/index.js`; Bun's `process.execPath` is not Node coverage. Required build/runtime/assets must fail their designated check when absent, not silently pass. Run applicable lint/type checks as well. Automated filesystem/process evidence uses Linux CI; record runtime versions and filesystem context. No tests may clean/discard real project metrics or publish/install packages globally.

Do not execute `AT-*` or human acceptance as implementor work. Leave acceptance to the acceptance workflow, with accurate prerequisites and sanitized automated evidence. Producer tests do not establish actual Runner/Evals integration. No human-only flow is required. If full Validator review is explicitly requested during implementation, use `bun run build:npm && node dist/index.js run` from this checkout, never a Validator executable from PATH.

Use new domain modules under `src/metrics/`, distribution assets under `contracts/model-metrics/v1/` and `contracts/validator-metrics/v1/`, and contract tests under `test/metrics/`. Consult `src/types/validator-status.ts`, `src/config/types.ts`, `src/cli-adapters/model-resolution.ts`, and `build.ts` for current public types and producer/build metadata conventions. Document the concrete contract, version policy, fixture manifest and provenance in the contract directories and `docs/`; read `docs/AGENTS.md` before documentation edits.

Read design sections “Contract versions and ownership,” “Record model,” “Measurement shape and accounting,” “Aggregates and standalone snapshot,” and the CLI response shapes. This is the shared schema/reducer/projection foundation, including protocol and artifact schemas. It does not implement storage transactions, CLI command handlers, real dispatch orchestration, or provider parsers. Shared standalone/discovery requirements below are owned here for their shapes and pure projections; command publication behavior remains an integration obligation. Shared receipt requirements are owned here for the envelope, canonical bytes, digest and compatibility fixtures, not receipt transactions.

Produce independent initial versions `measurement_schema_version`, `artifact_schema_version`, `protocol_version`, `capabilities_version`, and private `storage_version`, all starting at 1. Every record revision retains its own measurement version in its hash input. The v1 capabilities/protocol schemas must declare typed fields for default/maximum inventory/export counts, byte budgets and maximum individual record size, as required by `specs/nested-metrics-handoff/spec.md` “Validator-owned metrics retrieval interface” and design “CLI contract.” Define their shapes and validity relationships without treating runtime limits as immutable schema constants. Concrete operational values, enforcement and packaged examples are owned by the metrics CLI implementation; no new schema fields should be needed to choose those values. Define closed nested fields/source variants/enums, typed unavailable values and diagnostics, and version bumps for new fields including optional additions. Existing schema-declared optional evidence must round-trip losslessly. No opaque extension bag, blind forwarding, or lossy stripping.

Implement complete replacement invocation/attempt envelopes and deterministic RFC 8785 JCS UTF-8/SHA-256 generation and verification excluding only the top-level digest. Reject duplicate keys before ordinary parsing loses that information, invalid Unicode, non-finite numbers, and invalid exact-token integers. Include original JSON, exact canonical bytes, expected digests, acceptance/rejection and semantic projections in a pinned fixture manifest. Do not substitute default JSON stringification for JCS. Keep Node/Bun portability and the approved expectation of no new runtime dependency; do not replace the architecture with a database or cross-language runtime package.

Implement the canonical fields and reviewed derivation rules, native-source separation, availability/origin/precision independence, and inclusion/non-overlap relationships. Unknown cache-write prevents unsupported uncached derivation; reasoning included in output is not added again. Stable identity/allocation/cost IDs and within-revision references must preserve partial allocation, unallocated usage, scoped cost/currency/coverage, and overlap without pricing. Exclude prompts, responses, credentials, environment values and account/user/organization/email/host data from every schema surface including diagnostics.

Implement pure latest-head selection, conflict detection, invocation/session reducers and lossless snapshot/export projection functions. Retain failed work, typed category coverage and incomplete history, incomparable provider-total groups, unknown identities and work-duration versus elapsed-time distinction. Mixed versions require explicit reviewed mappings; retain incompatible latest heads as limitations instead of using older compatible measurements. Exercise future versions with test-only schemas, without shipping a fictitious production v2. Shared original JSON/bytes/hashes must be usable by Runner Go and Evals independently; their runtime execution belongs to companion CI and must remain reported as outstanding until actually performed.

## Spec

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

### Requirement: Requested resolved and observed model identity

Measurements SHALL distinguish requested configuration, resolved launch configuration, and telemetry-observed effective identity. Requested/resolved adapter or CLI, provider, model, and effort information SHALL NOT be represented as telemetry-observed identity without supporting evidence. Each recorded identity value SHALL carry its provenance, and unavailable identity fields SHALL explicitly state their unavailability and reason. Effective identity MAY contain multiple models where the source establishes them.

#### Scenario: Only launch configuration is known
- **WHEN** Validator resolves and launches a requested model but the source does not confirm the effective model
- **THEN** requested/resolved identity remains available while observed effective-model identity remains unavailable

#### Scenario: Observed model differs from the request
- **WHEN** telemetry identifies a different effective model from the requested or resolved model
- **THEN** both identities and their provenance are retained rather than overwriting one with the other

#### Scenario: Mismatch is retained on failure
- **WHEN** execution fails after reporting an effective model different from the request
- **THEN** the failed attempt still preserves the observed mismatch as evidence

#### Scenario: Multiple observed models and unknown effort
- **WHEN** a source establishes several effective models but does not report effective effort or provider for some identity fields
- **THEN** the established models remain distinct and the unsupported identity fields remain explicitly unavailable

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Explicit canonical token accounting

Each attempt SHALL expose the canonical token fields `input_total`, `input_uncached`, `cache_read`, `cache_write`, `output`, `reasoning`, and `provider_total` with these semantics:

- `input_total`: all input, including cache categories where the source establishes that accounting.
- `input_uncached`: input excluding cache-read and cache-write categories.
- `cache_read`: input served from cache.
- `cache_write`: input written to cache.
- `output`: output tokens with reasoning inclusion explicitly stated.
- `reasoning`: reasoning tokens with inclusion relationships explicitly stated.
- `provider_total`: the provider-reported total with its source-specific accounting semantics, not an assumed normalized total.

Every field SHALL express availability, its value, source provenance, whether observed or derived, precision, applicable derivation, and known inclusion relationships or their unavailability. Unsupported/unavailable fields SHALL be explicit with a null value and reason; they MUST NOT silently become zero or disappear as though zero were observed. A normalized grand total SHALL be available only when sufficiently complete components and their non-overlap are established. Derived breakdowns likewise SHALL require established component relationships; a known grand total alone does not establish cache or reasoning breakdowns.

Negative, non-finite, or internally inconsistent evidence SHALL NOT be silently accepted as a valid normalized measurement. Such evidence SHALL produce diagnostics and applicable unavailability while retaining safe source evidence separately from valid normalization.

#### Scenario: Cached input is included in input total
- **WHEN** verified source semantics report input total 100 including 40 cache-read tokens
- **THEN** normalized input consumption is 100 rather than 140
- **AND** the cache-read field records its inclusion in input total

#### Scenario: Reasoning is included in output
- **WHEN** verified source semantics report output 30 including 10 reasoning tokens
- **THEN** output contributes 30 rather than 40 to an applicable normalized total

#### Scenario: Unknown overlap prevents a grand total
- **WHEN** reported categories have unknown inclusion relationships that prevent establishing a complete non-overlapping sum
- **THEN** the normalized grand total is unavailable with a reason while the known individual fields remain usable

#### Scenario: Unknown cache-write breakdown prevents an uncached derivation
- **WHEN** input total and cache-read usage are known but an unknown cache-write component could also be included
- **THEN** Validator does not label input total minus cache-read usage as established uncached input

#### Scenario: Unsupported field differs from observed zero
- **WHEN** one source explicitly reports zero cache-write tokens and another source cannot expose that field
- **THEN** the former records an available observed zero and the latter records null with an unavailability reason

#### Scenario: Complete total with unavailable breakdown
- **WHEN** verified input/output semantics establish a complete non-overlapping total but no separate reasoning breakdown is reported
- **THEN** the normalized total can remain available while reasoning remains unavailable
- **AND** no claim of a complete canonical breakdown or priceable usage follows from total availability alone

#### Scenario: Invalid measurement is diagnosed
- **WHEN** source evidence contains a negative or non-finite count or a cache count inconsistent with its established containing total
- **THEN** normalization reports the inconsistency instead of publishing a silently valid count or fabricated corrected total

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Version provenance precision and independent completeness

Measurements SHALL identify the Validator producer version and build provenance, adapter name and parser/mapping version, underlying CLI version, and usage-source format/event version. Producer and parser/mapping versions SHALL identify the measuring implementation; build revision, CLI version, or source event version that cannot be established SHALL remain explicitly unavailable with a reason rather than be invented. A source with no exposed event-version identifier SHALL be documented as such.

Derivation and precision SHALL remain separate dimensions. Direct observations SHALL distinguish exact from approximate values; derived values SHALL identify their derivation and preserve input uncertainty rather than become exact by arithmetic. History completeness, collection completeness relative to the source, identity availability, canonical-field coverage, normalized-total completeness, and per-model attribution SHALL remain independent. Complete collection of an approximate source MUST NOT be represented as exact or as a complete canonical breakdown.

#### Scenario: Rounded display count remains approximate
- **WHEN** the supported source exposes a rounded display value such as `17.7k`
- **THEN** its normalized numeric representation remains approximate with provenance identifying the rounded source

#### Scenario: Derivation retains uncertainty
- **WHEN** a derived subtotal uses an approximate observed count
- **THEN** the result identifies both its derivation and its approximate precision

#### Scenario: Source collection is complete but fields are unsupported
- **WHEN** all usage exposed by a source was captured but that source omits a canonical category
- **THEN** source collection can be complete while that category remains unavailable and canonical-field coverage remains limited

#### Scenario: Output is truncated
- **WHEN** collection ends with only a truncated portion of source telemetry
- **THEN** known evidence remains available and collection limitations are explicit rather than inferred complete

#### Scenario: Cumulative metrics overlap request events
- **WHEN** the source provides cumulative counters and request events describing overlapping usage
- **THEN** normalization uses established source semantics to avoid counting the same usage twice
- **AND** unresolvable overlap prevents a complete accounting claim

#### Scenario: Version metadata is only partly observable
- **WHEN** Validator and parser/mapping versions are known but the CLI or source event version cannot be established
- **THEN** the known versions are retained and unavailable version fields state their limitations explicitly

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Multiple-model allocations and unallocated usage

An attempt SHALL retain per-model usage only where supported by source evidence and SHALL retain usable attempt-level unallocated usage where allocation cannot be established. `per_model_attribution` SHALL be `complete`, `partial`, or `unavailable`, independently of overall usage collection and total-token completeness. Identity evidence alone MUST NOT justify manufactured allocations.

An attempt's per-model and unallocated representations SHALL identify their relationship to its aggregate usage so allocation details are not counted again as additional consumption. A partial allocation SHALL report a numeric remainder only where the relationship needed to derive it is established.

Every represented allocation SHALL have a stable `allocation_id` within its attempt. Observed identity entries SHALL have stable attempt-local `identity_id` values; an allocation's `observed_identity_ref` SHALL resolve to its established identity entry or explicitly report unavailability. Observed identity context for unallocated usage SHALL NOT be treated as an allocation to every listed model. Finalization, array reordering, export, and newer revisions updating the same allocation SHALL preserve IDs; IDs SHALL NOT be repurposed for different source scopes or identities. All references SHALL resolve within the same complete attempt revision. Allocation rows and their participating-attempt counts SHALL NOT be interpreted as additional dispatches.

#### Scenario: Allocation references remain stable across revisions
- **WHEN** a newer attempt revision updates usage in an existing allocation or reorders its identity/allocation entries
- **THEN** the allocation and identity IDs remain stable and their references still identify the same source-supported scope
- **AND** the update does not create another model dispatch

#### Scenario: Unallocated usage retains identity context without a false join
- **WHEN** an attempt establishes several observed models but cannot assign its remaining usage to one of them
- **THEN** the unallocated representation retains its own allocation ID and explicit unavailable exact-identity association
- **AND** the observed identity set is not used to duplicate or divide that usage across models

#### Scenario: Source provides per-model rows
- **WHEN** a source provides a defensible usage breakdown for each effective model
- **THEN** the attempt retains that breakdown and its attribution completeness

#### Scenario: Several identities share aggregate-only usage
- **WHEN** a source reports multiple effective models and only aggregate usage
- **THEN** the attempt retains the aggregate as unallocated and reports per-model attribution unavailable without dividing or repeating usage across models

#### Scenario: Partial attribution has a defensible remainder
- **WHEN** a known subset of an established aggregate is attributed to one model and the remainder can be derived without overlap
- **THEN** the attempt retains that model allocation and unallocated remainder with partial attribution

#### Scenario: Allocation rows are not extra work
- **WHEN** an aggregate is computed from an attempt containing per-model and unallocated usage details
- **THEN** each measured token contributes once and the attempt count remains one for that dispatch

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Typed deduplicated invocation and session aggregates

Validator SHALL derive invocation and session aggregates from distinct underlying attempts, including failed attempts with usage. Attempts are the accounting authority; raw evidence, normalized fields, per-model allocations, invocation/session summaries, and transport revisions MUST NOT be treated as independent additive consumption.

Each aggregate token measurement SHALL carry a typed availability envelope containing the known subtotal, applicable coverage, fidelity, and reasons for unavailable or incomplete values. Coverage SHALL make the reporting and missing attempt population explicit for that measurement. A complete total SHALL require complete applicable history and sufficiently complete values for the relevant attempts; an incomplete population SHALL retain its known subtotal without treating missing values as zero. Confirmed zero dispatch SHALL be distinguishable from an unknown population.

Identity groupings SHALL retain unknown and unallocated attribution without guessing model membership. Replayed copies of the same record/revision SHALL not add consumption. Conflicting evidence for the same identity/revision SHALL produce a diagnostic rather than an arbitrary sum or silent choice. Legitimate newer revisions update the same attempt's derived views. Attempt work durations MAY be summarized as work duration, but summed overlapping durations MUST NOT be presented as invocation/session elapsed time.

Aggregation SHALL select each attempt's latest revision once, not its latest compatible older revision. Cross-version contributors SHALL use explicitly reviewed semantic mappings with source-version provenance; incompatible or uninterpretable current heads SHALL remain visible as coverage limitations or separate semantic groups. Root aggregates SHALL identify their own measurement schema version. Preserving an older record SHALL NOT require altering that record to calculate a newer aggregate.

#### Scenario: Mixed versions have comparable measurements
- **WHEN** a session has current heads in different supported measurement versions and a reviewed mapping establishes comparable input/output semantics
- **THEN** the root aggregate combines each attempt once under its declared aggregate schema with contributing version provenance

#### Scenario: Latest revision cannot contribute to an aggregate
- **WHEN** an attempt's latest revision cannot be semantically mapped to an aggregate but an older revision could
- **THEN** the current head is retained and the aggregate reports the limitation instead of substituting the older revision or claiming complete coverage

#### Scenario: Two distinct attempts contribute once
- **WHEN** two attempts report complete comparable token counts of 100 and 50
- **THEN** the applicable aggregate is 150 with two contributing attempts

#### Scenario: One attempt lacks the measurement
- **WHEN** one attempt reports a category and another eligible attempt cannot report it
- **THEN** the category aggregate retains the reporting attempt's known subtotal and identifies incomplete coverage
- **AND** it does not claim a complete total by substituting zero for the other attempt

#### Scenario: Category coverage differs from total coverage
- **WHEN** every attempt has a reliable normalized total but only some report separate cache usage
- **THEN** normalized-total coverage and cache-category coverage are reported independently

#### Scenario: Preserved result references old usage
- **WHEN** a current invocation preserves a prior review result without dispatch
- **THEN** the old attempt remains part of its originating invocation/session history and does not contribute new usage to the current invocation

#### Scenario: Replayed record is deduplicated
- **WHEN** the same attempt record/revision is encountered more than once
- **THEN** derived aggregates include its measured work only once

#### Scenario: Conflicting duplicate is diagnosed
- **WHEN** two incompatible payloads claim the same attempt identity and revision
- **THEN** the inconsistency is surfaced and the affected aggregate is not silently presented as a reliable complete sum

#### Scenario: Known population is empty
- **WHEN** complete invocation evidence establishes that no model attempt was dispatched
- **THEN** the aggregate expresses confirmed zero model consumption and zero attempts without inventing provider observations

#### Scenario: Earlier history is unavailable
- **WHEN** current attempt measurements are known but applicable earlier history is missing
- **THEN** known subtotals remain available while history limitations prevent a complete session-total claim

#### Scenario: Parallel attempts overlap in time
- **WHEN** two attempts each take ten seconds and execute during the same ten-second interval
- **THEN** their durations may represent twenty seconds of attempt work but are not reported as twenty seconds of invocation elapsed time

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

## Test Plan

Own INT-005's Validator schema/runtime, JCS, semantic fixture and pure projection boundary. Supply executable shared fixtures and expected outcomes for companion tests, retaining their execution as a separate prerequisite. Fixture projections exercise the real pure functions that persistence and CLI code consume; do not write a test-only alternate projection. Store retention and protocol tests must reuse this corpus for integrated mixed-version behavior. Pure normalization/reducer cases are selected from the copied scenarios through TDD, rather than creating a duplicate unit inventory.

From the approved `test-plan.md`, retained verbatim:

### INT-005: Versioned schemas and lossless cross-language measurement contracts

- Covers: VM versioning, canonical accounting, allocations, typed aggregates, and allowlisted pricing-independent evidence; NH “Semantics-preserving measurement export” and “Non-consuming exports and revision-bound receipts”; approved companion contract obligations in the design.
- Boundary: Published JSON Schemas ↔ runtime validators ↔ standalone/export projections; the same fixture package ↔ Runner's Go ingestion and Evals' measurement/valuation ingestion.
- Setup: Pin the schema and fixture revision. Provide original JSON, exact RFC 8785 canonical UTF-8 bytes, expected SHA-256, accepted/rejected schema outcomes, and expected semantic projections. Cases include fractional cost/exponent/signed-zero serialization, Unicode ordering/escaping, numeric limits and malformed input; known optional versus undeclared fields; requested-only identity; partial/approximate envelopes; prepared/terminal revisions and conflicting duplicates.
- Action: Validate and project the same fixtures as snapshots and exports; verify digests before transformation. Run the shared corpus in each companion's actual implementation when that implementation is available. Exercise one attempt observing A and B, total 150, allocation A of 100, unallocated remainder 50, and cost only for A; also test overlapping whole-attempt/allocation costs, unknown currency/scope, stable joins after reordering/revisions, and new usage exceeding old cost coverage.
- **Mixed-version cases:** A failed v1 invocation is retained through a producer upgrade and a new-version retry in the same session; the pending scope and snapshot contain both versions. Exercise explicitly declared consumer version sets, required-version errors before any receipt, per-record versions covered by digests, actual batch version sets, and separately versioned root aggregates. Use explicitly test-only later-version schemas until another production version exists; do not publish a fictitious v2 merely for this fixture. Include a reviewed comparable mapping and an incompatible current head with an older compatible revision: preserve source bytes and known coverage without fallback to stale measurements, relabeling, dropping, or double-counting.
- Assertions: Schema/runtime agreement; identical expected canonical hashes across supported runtimes/languages; all supported evidence preserved, including declared optional fields. Undeclared fields/unsupported versions reject without acknowledgment; no opaque unknown-field forwarding. Allocation/cost references stay within the selected attempt revision; allocation-only cost never resolves uncovered work. Runner selects one current head per producer attempt while preserving digest/revision/original attribution/gaps. Evals keeps overall dispatch counts separate from row participation, preserves unknown cache-write, and distinguishes known subtotal from complete non-overlapping cost. Whole token-total availability does not establish billing completeness.
- **Constraints:** Validator fixtures and projection checks are required for producer acceptance. Runner/Evals executions are required for their companion acceptance and end-to-end readiness, not silently presumed from Validator passing. No Go/Evals runtime dependency need be added to ordinary Validator CI; each repository must pin and run the shared corpus in its own CI. Until those implementations exist, record that cross-language/consumer execution is outstanding, not passed. Use fixture evidence and locally controlled valuation inputs, not live rate lookup or paid judges, for automated contract assertions.
- Execution: Validator `test/metrics/` contract tests via `bun run test`; companion Go/JavaScript contract tests in their separately authorized changes/CI. Record versions and fixture revision in acceptance evidence.

## Done When

- Published v1 schemas, runtime validators, pure reducers/projections, and versioned fixture manifest agree; all accepted fields and source versions survive both projections. Capabilities/protocol schemas explicitly declare all advertised limit fields and their types/relationships; concrete runtime values and executable packaged examples remain part of the CLI delivery boundary.
- All copied domain scenarios within this foundation’s stated scope and the schema/JCS/pure-projection portion of INT-005 pass, including the 150/100/50 partial allocation with allocation-only cost, overlap, unknown currency/scope, cost coverage after later usage, mixed-version latest-head behavior and canonicalization rejection cases.
- The schema and contract documentation explain unknown versus zero, immutable replacement revisions, independent versions, digest input, supported numeric bounds and pricing ownership.
- Shared fixture outputs are ready for separately authorized Go/JavaScript consumer verification. Integrated mixed-version retention/export checks remain outstanding until the real store and CLI exercise them; do not mark all Validator portions of INT-005 complete from pure projections alone. Unexecuted companion checks and targeted contract confirmation are not marked passed.
