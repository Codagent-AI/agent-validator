---
title: Metrics Contract
group: Reference
order: 80
description: Versioned model-measurement and standalone-artifact contracts.
---

# Metrics Contract

Agent Validator's metrics foundation uses closed, versioned JSON contracts in `contracts/`. The v1 delivery defines independent versions for measurements, standalone artifacts, the export protocol, capabilities, and private storage. A newer record version never rewrites or relabels retained evidence.

Every token field is either available with a value or unavailable with a reason. Unavailable is not zero. Provider-native usage remains separate from normalized fields, and normalized totals are only produced where overlap is established. Cached input and reasoning included by a containing field are not counted twice.

Model attempts carry requested, resolved, and observed identities separately. Allocation and cost references use stable attempt-local IDs. Costs are pass-through provider evidence with currency, coverage, and scope; Validator does not look up rates or estimate a price.

The export digest is SHA-256 over RFC 8785 canonical UTF-8 JSON for the complete replacement record except its top-level `digest` member. The pinned compatibility fixtures include original input, canonical bytes, expected hashes, and rejection cases. Consumers should pin a reviewed contract version and run those fixtures in their own implementation.

Each `run`, `check`, and `review` execution has a distinct `invocation_id`. Programmatic results expose it in additive `telemetry` metadata with the associated `session_id`, resolved `artifact_path`, and publication ownership/state. A persistence failure is reported as `degraded` or `unavailable`; an existing snapshot is never represented as current-command evidence.

For Runner correlation, validation commands accept paired opaque values: `--metrics-consumer <name>` and `--metrics-context <id>`. They are stored as data, not interpreted as paths. Actual review dispatches additionally receive an `attempt_id`, written into their review JSON artifacts and gate subresults. Preserved or skipped review results do not create a new attempt.

Targeted Runner and Evals confirmation and their real shared-fixture executions remain outstanding integration prerequisites.

## Session closure and retention

`clean`, `skip`, successful validation cleanup, retry-limit cleanup, and existing context-change cleanup all use the configured `max_previous_logs` value. Closing a measured session publishes the fixed `validation-metrics.json` snapshot and, when retention is nonzero, stores one immutable as-of-close copy beside that session's archived logs in `previous/`. Metrics-only sessions consume one normal archive slot. With `max_previous_logs: 0`, ordinary current logs are removed but no archive is created or rotated; the latest snapshot and pending delivery evidence remain available.

Closure uses a same-filesystem journal below the private metrics store. If a process stops during closure, the next locked validation or clean continues the frozen transaction rather than rediscovering root files or rotating the archive again. A conflicting or inaccessible journal is reported as degraded telemetry: validation may continue, but it does not claim a durable close. This protection is designed for local POSIX-style filesystems and cannot recover files removed externally, moved across filesystems, or lost with the disk.

Historical snapshots are immutable records of the session at close time. They may age out with their log archive, but this does not acknowledge, discard, or otherwise alter pending delivery evidence. Use the public `metrics` retrieval commands to export, acknowledge, or explicitly discard delivery evidence; never edit `.metrics/` directly. Older binaries that do not understand this store must use an isolated log directory rather than cleaning it.
