## ADDED Requirements

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

### Requirement: Stable attempt identity and review correlation

Every `run`, `review`, and `check` command execution SHALL receive a distinct invocation identity. Every actual model-backed adapter dispatch SHALL receive a distinct stable `attempt_id` and retain its parent invocation/session identity, gate, review slot, adapter, and retry/run context. Review result records and per-review JSON artifacts for actual dispatches SHALL reference their telemetry attempts. Provider CLI session identity and consumer workflow correlation SHALL remain separate from Validator's identities.

Finalization, rereading, archival, or delivery replay SHALL preserve an existing attempt identity. New dispatches SHALL NOT reuse it. Skipped review slots and preserved one-shot results SHALL NOT create new model attempts or assign earlier consumption to the current invocation; an available reference to earlier evidence remains a historical reference. One adapter dispatch is one attempt, not one attempt per provider-internal request or observed model.

#### Scenario: Parallel dispatches use the same adapter
- **WHEN** multiple gates or review slots dispatch the same adapter concurrently
- **THEN** each actual dispatch has its own attempt ID and unambiguous gate/slot and parent-invocation context
- **AND** collection sources are isolated per dispatch, including same-clock-tick launches, and one dispatch's cleanup cannot destroy another's evidence

Collection from a shared source SHALL require source-supported per-attempt correlation. Ambiguous or cross-contaminated observations SHALL NOT support complete per-attempt measurements; unaffected established evidence MAY remain available with explicit partial/unavailable affected fields. Source cleanup SHALL affect only the owning attempt's resources.

#### Scenario: Shared collection cannot establish ownership
- **WHEN** a collection source contains observations from several attempts without reliable source correlation
- **THEN** the adapter reports attribution/collection limitations rather than assigning their combined usage to one attempt or guessing a split

#### Scenario: Actual retry creates new consumption
- **WHEN** a previously failed review is dispatched again
- **THEN** it receives a new attempt ID and retains the earlier attempt as distinct history

#### Scenario: Finalization and archival preserve identity
- **WHEN** an attempt is finalized, reread, archived, or exported again
- **THEN** its identity and originating invocation/session remain unchanged

#### Scenario: Review result joins to telemetry
- **WHEN** a review dispatch produces a result and its JSON artifact
- **THEN** the result and artifact identify the corresponding telemetry attempt without requiring filename or execution-order inference

#### Scenario: Preserved and skipped reviews create no attempts
- **WHEN** a command skips a previously passed review or preserves a one-shot result without dispatch
- **THEN** that decision creates no new model attempt or current-invocation usage
- **AND** the enclosing validation command still has its own invocation identity

### Requirement: Attempt lifecycle and failure evidence

Validator SHALL persist attempt identity and initial lifecycle evidence before dispatch when storage permits, retain observed evidence through controlled success and failure paths, and finalize the same attempt on terminal execution. Parallel updates SHALL NOT lose another attempt's recorded evidence. Adapter execution outcome, review findings, and telemetry completeness SHALL be independently represented.

Interrupted attempts SHALL retain their last persisted evidence and explicit incomplete lifecycle/collection state; Validator MUST NOT invent terminal usage or success. Initial or final telemetry persistence failure SHALL warn and make publication/history degradation explicit without preventing validation or changing its outcome or exit code.

#### Scenario: Review violations with complete telemetry
- **WHEN** an adapter completes with review violations and complete source usage
- **THEN** the attempt retains the failed review outcome and independently complete usage collection

#### Scenario: Failure or timeout retains partial evidence
- **WHEN** an adapter fails or times out after reporting some usage or identity evidence
- **THEN** the terminal attempt retains that evidence with its failure and applicable collection limitations

#### Scenario: Process interruption leaves an incomplete attempt
- **WHEN** initial attempt evidence was persisted but the process is interrupted before finalization
- **THEN** the stored attempt retains its identity and known evidence without a fabricated successful outcome or final usage count

#### Scenario: Initial persistence fails
- **WHEN** recording initial telemetry fails before an otherwise permitted dispatch
- **THEN** validation continues with a warning and degraded telemetry state rather than claiming successful durable recording

#### Scenario: Final persistence fails
- **WHEN** validation completes but writing terminal telemetry fails
- **THEN** validation outcome and exit code remain unchanged while publication/history limitations are surfaced

#### Scenario: Parallel finalizations retain both attempts
- **WHEN** two reviews finalize concurrently
- **THEN** successful telemetry persistence retains both attempts and their evidence rather than overwriting one with the other

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

### Requirement: Documented adapter support and representative evidence

Validator SHALL document a field-level telemetry support matrix and collection prerequisites for its Claude, Codex, Cursor, Gemini, GitHub Copilot, and OpenCode adapters. Documentation SHALL distinguish fields the adapter/source cannot report from fields unavailable because collection was disabled, redirected, incomplete, or unrecognized. Requested/resolved configuration MUST NOT be documented as verified effective identity merely to fill a support gap.

Adapter parsers SHALL be validated against recorded representative CLI output before their values can be labeled complete. Fixtures SHALL exercise applicable identity evidence, rounded counts, accounting relationships, and overlapping metric/request sources. Unrecognized formats SHALL yield explicitly partial/unavailable measurements rather than fabricated zeros or unsupported completeness claims. Versioned contract fixtures SHALL support verification that the standalone artifact and consumer export preserve the same measurement semantics.

Producer acceptance SHALL require evidence-backed canonical `input_total` and `output` usage for both Codex and Claude on representative successful dispatches, with established accounting relationships and declared precision. An implementation reporting every token category unavailable SHALL NOT meet this acceptance floor. This floor SHALL NOT imply complete cache/reasoning categories, effective identity, or failure-path collection where evidence cannot establish them. Missing representative recordings SHALL block the affected support/acceptance claim, not permit a synthetic support claim or lower the floor. New paid/live captures require separate authorization.

Legacy log-based reports, including `review-audit` and `newsletter-metrics`, SHALL be documented as outside this migration and its measurement-accuracy guarantees. Documentation SHALL identify `review-audit`'s existing zero-filling limitation and direct machine consumers to the new artifact/handoff. This change SHALL NOT claim those legacy reports are migrated or authoritative for the new contract.

#### Scenario: Minimum useful adapter support is not established
- **WHEN** either Codex or Claude lacks recorded evidence substantiating its supported input/output mapping
- **THEN** producer acceptance remains incomplete even if persistence and handoff tests pass
- **AND** no live/paid capture is implicitly authorized to resolve the missing evidence

#### Scenario: Unsupported field versus disabled collection
- **WHEN** an adapter cannot expose a field and another configured execution disables otherwise supported collection
- **THEN** documentation and runtime unavailability reasons distinguish the two conditions

#### Scenario: Parser encounters an unrecognized format
- **WHEN** CLI output differs from a supported telemetry format
- **THEN** unsupported measurements remain partial or unavailable with diagnostics rather than silently complete or zero

#### Scenario: Representative fixtures establish parser claims
- **WHEN** an adapter parser claims complete collection or defensible normalized totals
- **THEN** recorded representative fixtures verify its applicable identity, rounding, category-inclusion, and metric/request-overlap behavior

#### Scenario: Artifact and export use the same measurement semantics
- **WHEN** a contract fixture containing partial identity, approximate usage, and unallocated model usage is materialized as a standalone snapshot and consumer export
- **THEN** both preserve the same accounting evidence, provenance, uncertainty, and attribution semantics
