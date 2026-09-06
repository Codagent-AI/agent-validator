# Implementation tasks: Agent Validator metrics instrumentation

The approved definition is **XL**: it combines a new shared measurement contract, durable concurrent file commits, six source-specific collector integrations, controlled executor finalization, a bounded delivery protocol and recoverable log rotation. Six delivery units separate independently verifiable foundations and distinct implementation risks. Provider variants stay together; documentation, fixtures, CI and package propagation stay with the outcomes they support. This plan creates no implementation or executed acceptance evidence.

The proposal, specifications, design and test plan remain approved and unchanged. Targeted interoperability confirmation of the revised contract remains a prerequisite before implementation as recorded in those artifacts; both original companion reviews are already received. Shared executable fixture verification remains a companion integration prerequisite. These are retained prerequisites, not claims that they have passed, and no new product decision or task-grouping approval is requested.

- [ ] [Define versioned measurement contracts and deterministic projections](tasks/01-measurement-contracts.md)
- [ ] [Persist invocation and attempt revisions with atomic snapshots](tasks/02-durable-recording.md)
- [ ] [Collect evidence-backed telemetry from all review adapters](tasks/03-adapter-collection.md)
- [ ] [Record every validation invocation and correlate actual review dispatches](tasks/04-command-lifecycle.md)
- [ ] [Deliver bounded metrics retrieval, receipts and packaged Node contracts](tasks/05-metrics-cli-distribution.md)
- [ ] [Integrate recoverable session closure across every cleanup path](tasks/06-recoverable-session-closure.md)

## Ordering and dependencies

| Delivery unit | Required existing interfaces/outcomes | Why this boundary stands alone |
| --- | --- | --- |
| 01 Contracts | Approved contract and targeted interoperability confirmation | Closed schemas, JCS fixtures and pure reducers/projections can be verified without orchestration or providers |
| 02 Durable recording | 01 | Real interprocess commits and atomic snapshots have independent durability and concurrency risks |
| 03 Adapter collection | 01, 02 | The six native telemetry formats and shared process-finalization path need their own recorded fixture/process suite |
| 04 Command lifecycle | 01, 02, 03 | Controlled exits and actual-dispatch integration must preserve existing validation/report/scheduling semantics |
| 05 Metrics CLI and distribution | 01, 02, 04; adapter fixtures from 03 for representative operations | Public bounded receipts and structured CLI errors are independently exercisable, including real package/runtime discovery |
| 06 Recoverable closure | 02, 03, 04, 05 | Archive construction and caller cutover stay together; public metrics delivery is needed to prove recovery independence |

Follow the numbered sequence. Prerequisite interfaces and each unit's share of overlapping requirements are described in its standalone file; no task file depends on another task's prose. Intermediate units do not constitute producer release readiness while production closure and the acceptance obligations remain incomplete.

## Automated obligation ownership

| Obligation | Primary task | Required integration supplements and boundaries |
| --- | --- | --- |
| INT-001 | 02 | Real recorder/store/publisher first; 04 verifies its result-preservation and membership guarantees through actual executors |
| INT-002 | 06 | All cleanup callers and configured depths, including run/gate-command/detect context-change entry points; exhaustive coordinator crash/flush matrix and public export/ack during unfinished closure |
| INT-003 | 05 | Full protocol boundary; 06 additionally completes reclamation through normal production closure/latest/reference release and archive-phase recovery |
| INT-004 | 03 | Actual collectors/processes with real recorder and shared snapshot/export projections; 05 also checks delivered export surfaces against fixtures |
| INT-005 | 01 | Validator schemas/JCS/semantic corpus and pure projections; 02/05 reuse it for real mixed-version storage/export. Actual companion execution remains separate |
| INT-006 | 05 | Actual package contents, schema discovery and supported Node runtimes in CI/release validation gates; no publishing |
| E2E-001 | 06 | Failed review → retry → success → post-clean measurements, first complete when production closure is connected |
| E2E-002 | 06 | Interrupted closure → metrics-only durable delivery/replay → later closure recovery |
| E2E-003 | 05 | Built zero-dispatch/early-error commands plus scoped retrieval; 04 supplies non-exiting executor regression coverage |

Every primary INT/E2E obligation is reproduced in full in its owning file. Integration supplements preserve the same obligation rather than waive assertions or duplicate product implementations. Until the named supplements execute, the corresponding complete obligation remains incomplete. Unit cases are chosen through implementation-time TDD from verbatim specification scenarios. Source tests run through `bun run test`; built distribution/CLI checks are wired into `bun run test:e2e` after build, preserving existing Docker coverage. Use explicit Node runtimes, Linux process/filesystem CI, deterministic credential-free provider processes, unique temporary resources and synchronization barriers. Missing required assets/runtimes must fail designated checks.

## Acceptance and external prerequisites

AT-001 (standalone retained measurements) and AT-002 (bounded public retrieval/acknowledgment/explicit discard) retain classification `Required` for producer acceptance and are executed by the acceptance workflow, not these implementors. AT-003 retains classification `Conditional: once the separately authorized Runner and Evals integrations and agreed contract versions/fixtures are available`. It remains outstanding before activation and is required before any complete three-repository integration or nested eval-cost readiness claim. No human-only testing is required. The authoritative procedures, evidence and permitted substitutes remain in [test-plan.md](test-plan.md).

The Codex and Claude recorded canonical input/output support floor is mandatory for producer acceptance; missing recordings cannot be replaced by synthetic accounting claims, all-unavailable output or unapproved paid/live capture. Validator owns and packages the shared corpus; Runner Go and Evals must pin and execute it in separately authorized changes/CI. A simulated consumer proves the Validator interface only, never Runner/Evals implementation or AT-003. No companion code change, live pricing/provider request, stopped evaluation artifact mutation or production release is part of this implementation breakdown.
