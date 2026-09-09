# Task: Collect evidence-backed telemetry from all review adapters

## Goal

Return safe structured measurements alongside review text, retaining available provider evidence through failures and cleanup with defensible Codex and Claude input/output support.

## Background

Paths under `src/`, `test/`, `docs/`, `contracts/`, and `.github/` are relative to the repository root. Definition references are relative to `openspec/changes/agent-validator-metrics-instrumentation/`. New metrics modules, contract assets, and `test/metrics/` are planned implementation paths, not claims that they already exist.

Read the approved `proposal.md`, the relevant sections of `design.md`, and `test-plan.md` (including Coverage Strategy and Completion and Evidence Boundaries), together with repository `AGENTS.md` and `test/AGENTS.md`. The verbatim specification requirements below are authoritative; the scope explanation identifies this delivery unit's portion where a requirement spans several boundaries.

This change implements Validator only. Preserve Validator measurement → Runner attribution/consolidation → Evals valuation ownership. Do not implement companion repositories, modify/regenerate the stopped evaluation artifact, introduce pricing/rate lookup, backfill from logs, or add a JSONL sink. Both companion reviews and the resolutions are approved; targeted confirmation of the revised contracts remains an implementation prerequisite, not a reason to repeat broad design review or claim interoperability passed. Track that prerequisite from `handoffs/agent-runner/handoff.md` and `handoffs/agent-evals/handoff.md`; these task files do not assert that confirmation has occurred.

Implement specification behavior with meaningful TDD and regression coverage. Use dependency injection, unique absolute temporary directories, restored child environments, and explicit synchronization barriers. Persistence/locking/termination checks use real filesystems and independent processes; failure injection supplements those checks. Use deterministic provider executables for all child calls including health/version probes, without real provider credentials or fallback to authenticated installed CLIs. Existing sanitized recordings must substantiate supported mappings; synthetic variations cannot establish provider accounting semantics. New live/paid captures are not authorized.

Source tests belong in the affected `test/metrics/`, `test/cli-adapters/`, `test/gates/`, `test/core/`, and `test/commands/` areas and run with `bun run test`. Built CLI tests belong in `test/integration/`, after `bun run build:npm`, and must be wired into `bun run test:e2e`, retaining its Docker coverage. Use an explicit Node executable with the absolute built `dist/index.js`; Bun's `process.execPath` is not Node coverage. Required build/runtime/assets must fail their designated check when absent, not silently pass. Run applicable lint/type checks as well. Automated filesystem/process evidence uses Linux CI; record runtime versions and filesystem context. No tests may clean/discard real project metrics or publish/install packages globally.

Do not execute `AT-*` or human acceptance as implementor work. Leave acceptance to the acceptance workflow, with accurate prerequisites and sanitized automated evidence. Producer tests do not establish actual Runner/Evals integration. No human-only flow is required. If full Validator review is explicitly requested during implementation, use `bun run build:npm && node dist/index.js run` from this checkout, never a Validator executable from PATH.

Integrate all six implementations: `src/cli-adapters/claude.ts`, `claude-otel.ts`, `codex.ts`, `cursor.ts`, `gemini.ts`, `github-copilot.ts`, and `opencode.ts`, together with `shared.ts`, `index.ts`, `model-resolution.ts` and `src/gates/review-runtime-helpers.ts`. Use the common measurement validators/reducers and recorder evidence-update interface from `src/metrics/`. Put process/collector fixtures and tests in `test/cli-adapters/`; update directly affected adapter test doubles and consumers so the tree remains coherent. Read design “Adapter integration and finalization” and the measurement shape sections.

Change `CLIAdapter.execute()` from review-text-only to `{ text, telemetry }` and add a typed failure carrying safe partial telemetry plus the original operational error for the existing error path. Update the common caller to extract review text for existing evaluation; telemetry must be available separately to dispatch recording. Carry the producer attempt ID into collector setup and allow meaningful validated partial-evidence callbacks. The caller supplies production invocation/gate context; adapter IDs must not manufacture separate invocations or count provider requests as dispatches. Direct collector tests may supply a test attempt/real recorder explicitly. This unit owns collection and shared process settlement, not command lifecycle allocation.

Ensure `runStreamingCommand()` and process-close handling collect/drain evidence before deleting its sources, settle once, preserve original timeout/process error categories, and bound terminal collection so a hung provider cannot hold validation open indefinitely. Late callbacks cannot replace terminal evidence. No extra model request discovers identity/versions or recovers usage. Version discovery is bounded, cached within an invocation and unavailable with a reason when unsupported.

Each dispatch owns collision-resistant source files/directories using its attempt identity; PID plus timestamp alone is insufficient. In particular Gemini's OTel sink must be unique even for same-clock-tick launches and compatible with its sandbox. Sibling cleanup cannot remove it. Shared observations need source-established correlation; ambiguous attribution degrades only affected values without guessed splitting.

Integrate Codex structured completion JSONL, Claude OTel metrics/request events, Gemini temporary OTel output, Copilot rounded summaries/model rows, and OpenCode step-finish usage. Cursor remains explicitly unavailable unless representative evidence establishes a mapping. Verify cumulative versus per-request/delta semantics, cache/reasoning overlap, source-specific identity, native cost and allocations. Preserve requested/resolved versus observed identity including mismatches on failure; preserve precision and source/parser/CLI versions independently of collection completeness. Keep existing human logging, findings and error semantics.

Only allowlisted usage/model/timing/version/correlation fields reach persisted records or export projections; canary coverage includes prompt/response/environment/credential and account/user/organization/email/host data, including diagnostics. Provider-reported costs remain scoped evidence; this does not calculate prices. Stable source/identity/allocation/cost references must survive updates and array reordering.

Start the recording inventory with read-only candidate captures in `evals/results/*.json`: for example, `evals/results/eval-2026-05-02T00-17-07.json` contains Codex `turn.completed` usage in `rawRuns[].telemetry[]`, and the results directory also contains Copilot telemetry captures. Inspect provenance, source versions or their explicit unavailability, successful-dispatch context and accounting relationships before treating any candidate as representative support evidence. Read and sanitize suitable provider-native observations into new `test/cli-adapters/` fixtures without modifying/regenerating the original evaluation artifacts or backfilling their measurements. Validator-formatted telemetry display lines are not a substitute for native source semantics. `test/cli-adapters/otel-scanner.test.ts` contains inline OTel parser samples; they are synthetic unless independent capture provenance establishes otherwise and cannot alone prove Claude support. No Claude recording was established by this task-planning review; search existing permitted evidence before declaring that prerequisite missing, and record any unresolved adapter recording, including Claude, as incomplete acceptance rather than inventing a fixture or authorizing live capture.

Document a field-level support/prerequisite/evidence matrix for all six adapters under `docs/`, following `docs/AGENTS.md`, including unsupported versus disabled/redirected/incomplete/unrecognized reasons and fixture provenance. Recordings must substantiate canonical `input_total` and `output` for both Codex and Claude; missing either blocks producer acceptance and cannot be papered over by synthetic fixtures or an all-unavailable implementation. Document legacy `review-audit` and `newsletter-metrics` as outside the contract, specifically `review-audit`'s zero-filling limitation, without changing those scripts or asserting the same defect in every script.

## Spec

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Dispatch lifecycle preserves failed and interrupted work

Each actual adapter dispatch SHALL allocate a new model attempt under its originating invocation, persist initial evidence before dispatch when possible, and retain evidence through success, review failure, adapter error, timeout, and controlled interruption. Controlled terminal outcomes SHALL finalize the same attempt before the invocation summary is finalized. Uncontrolled interruption SHALL leave already persisted attempts intact and incomplete; later execution SHALL NOT relabel them as successful or reuse their IDs for new work.

#### Scenario: Adapter failure follows partial usage
- **WHEN** a review adapter fails after reporting partial usage
- **THEN** invocation finalization retains the failed attempt and its known usage rather than dropping it from the invocation aggregate

#### Scenario: Parallel dispatches finish independently
- **WHEN** parallel reviews complete with different outcomes
- **THEN** invocation finalization preserves each attempt independently and derives the summary from the distinct attempts

#### Scenario: Retry follows process interruption
- **WHEN** a process is interrupted after initial attempt evidence is persisted and a later validation retries the work
- **THEN** the earlier attempt remains identifiable and incomplete while the actual new dispatch receives a distinct attempt ID

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: JSON Review Result Files
The review gate MUST write a structured JSON file for each adapter's review result alongside the markdown log file.

Result artifacts for actual model dispatches SHALL additionally reference the stable telemetry attempt ID. Review JSON remains mutable review evidence under its existing schema and lifecycle; its raw review output SHALL NOT be copied into metrics evidence. Missing or invalid review-result JSON SHALL NOT erase a separately recorded model attempt or its usage. Synthesized skipped/preserved results SHALL not fabricate a new attempt reference for work that did not occur; any reference retained from prior evidence remains historical.

#### Scenario: JSON file generation
- **WHEN** a review adapter completes execution
- **THEN** the system SHALL write a `.json` file with the same base name as the log file (e.g., `review_src_claude.1.json` alongside `review_src_claude.1.log`)
- **AND** the JSON file SHALL contain the adapter name, timestamp, status, raw LLM output, and violations array

#### Scenario: JSON schema for violations
- **WHEN** a violation is recorded in the JSON file
- **THEN** the violation object SHALL include a `status` field with initial value `"new"`
- **AND** the violation object SHALL include `file`, `line`, `issue`, `priority`, and optional `fix` fields
- **AND** the violation object MAY include a `result` field (initially null) for fix descriptions

#### Scenario: Invalid JSON output
- **WHEN** the reviewer LLM produces output that cannot be parsed as valid JSON
- **THEN** the system SHALL log an error indicating JSON parsing failed
- **AND** the system SHALL NOT write an incomplete JSON file
- **AND** the gate SHALL report an error status

#### Scenario: Missing required fields
- **WHEN** the reviewer LLM produces valid JSON but violations are missing required fields (`file`, `issue`, or `priority`)
- **THEN** the system SHALL log a warning indicating which fields are missing
- **AND** the malformed violation SHALL be excluded from the results

#### Scenario: Review artifact references its actual attempt
- **WHEN** an actual review dispatch produces a result artifact
- **THEN** the artifact identifies its telemetry attempt in addition to the existing review fields

#### Scenario: Invalid review output retains separate telemetry
- **WHEN** model usage was observed but the review response cannot be parsed into a valid result
- **THEN** the review continues to report its existing error outcome while separately persisted attempt telemetry retains the observed usage and failure evidence

#### Scenario: Preserved review creates no new measurement
- **WHEN** existing one-shot or passed-slot behavior writes a synthesized per-iteration result without dispatch
- **THEN** no new model attempt is created, and any prior attempt reference remains a reference to historical work

## Test Plan

Own INT-004's actual adapter/streaming helper → deterministic subprocess/source → real recorder and review-text handling boundary. Test full safe measurements through the real snapshot and export projection functions; deployed CLI exposure gets an additional smoke assertion once available. All variants of provider collection, timeout, failure, same-tick isolation and cleanup stay in this delivery unit. Unit arithmetic remains TDD against copied semantics. Record fixture source versions and capture provenance; a synthetic process replaying a sanitized real recording is allowed, a synthetic recording establishing provider semantics is not.

From the approved `test-plan.md`, retained verbatim:

### INT-004: Adapter collection through subprocess completion and cleanup

- Covers: VM “Requested resolved and observed model identity,” “Explicit canonical token accounting,” “Version provenance precision and independent completeness,” “Allowlisted evidence and pricing independence,” and “Documented adapter support and representative evidence”; RL “Dispatch lifecycle preserves failed and interrupted work.”
- Boundary: Each actual adapter/streaming helper → deterministic provider subprocess and applicable temporary telemetry files → recorder and review-output handling.
- Setup: Sanitized recorded representative source fixtures for Claude, Codex, Cursor, Gemini, GitHub Copilot, and OpenCode, appropriate to each claimed capability and the mandatory Codex/Claude input/output floor. Include structured events and OTel metric/request combinations, rounded display summaries, actual identity evidence, and explicit unsupported output. Controlled emitters provide barriers for partial output, truncation, timeout, process error, and delayed close. Use fake prompt/response/environment/credential/account/user/organization/email/host canaries, never real secrets or personal identifiers.
- Action: Run collectors through success and applicable failure paths; vary caller-directed collection configuration in isolated child environments; inspect telemetry after temporary-source cleanup and review parsing failures.
- **Isolation cases:** Launch multiple same-adapter dispatches at identical injected clock ticks, including Gemini's telemetry-file path, with distinct source counts. Overlap writes, reads, failure, and cleanup using barriers. Assert unique attempt-owned sources and no cross-attribution or deletion of a sibling's evidence. Inject shared uncorrelatable observations separately: affected fields degrade, never become complete combined usage attributed to one attempt.
- Assertions: Available evidence is extracted before destruction and retained through controlled failures without changing review semantics. Execution outcome, findings, and collection completeness stay independent. Requested identity is not promoted to observed identity. Overlapping cumulative/request sources are not double-counted; approximation and version limitations survive. Unsupported/redirected/unrecognized collection has the correct explicit limitation. Persisted/exported telemetry excludes canary prompt/response/environment/credential data and unrestricted event fields. Provider-reported cost is evidence, never a Validator-calculated price.
- **Safety/support assertions:** Account/user/organization/email/host canaries are absent from snapshots, exported records, source metadata, and diagnostics while permitted model and opaque execution identifiers survive. Recorded fixtures establish Codex and Claude input/output accounting rather than assuming all real Claude observations overlap. Field-support documentation must identify evidence/provenance and legacy report exclusions, including `review-audit` zero-filling, without claiming every legacy script has that token defect.
- **Constraints:** This is collector-to-process integration, not an inventory of individual parser arithmetic tests. A Cursor or other adapter fixture proving unavailability is valid; it cannot support a fabricated complete-usage claim. No additional live provider request is authorized to fill a missing fixture.
- Execution: `test/cli-adapters/` integration tests via `bun run test`; isolate processes and source files rather than relying on globally mocked adapter modules. Record fixture provenance and supported mapping versions with the fixtures/documentation.

## Done When

- Every adapter and its consumers use the structured success/typed failure contract without losing existing review text or operational error semantics.
- The collector/process/recorder portion of INT-004 passes with real controlled subprocesses and temporary sources, including same-tick same-adapter overlaps, bounded cancellation, late callbacks, mismatches, truncation, redirected collection and privacy canaries through persisted/projected surfaces. Record the delivered public-export fixture/canary supplement as outstanding until the metrics CLI exercises it; do not mark the complete INT-004 obligation passed solely from projection coverage.
- Stable allocation/identity/cost references, uncertainty, provenance and independently available fields survive collection and failure; unsupported formats never become complete zeros or guessed identity.
- All six adapter support rows document evidence and prerequisites, and recorded successful Codex and Claude fixtures substantiate canonical input/output. If recordings are missing, explicitly record acceptance as incomplete; do not declare this support obligation complete or initiate unapproved live/paid capture.
- Legacy report exclusions and the specific review-audit zero-fill caveat are documented, without migrating legacy reports.
