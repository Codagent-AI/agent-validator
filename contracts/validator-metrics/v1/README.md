# Validator metrics artifact contract v1

`validation-metrics.json` is the standalone snapshot shape. Its `artifact_schema_version` is `1`; record heads retain their own `measurement_schema_version`, and the root aggregate declares its separate aggregate measurement version. A set or maximum of record versions is not a conversion claim.

Capabilities are separately versioned (`capabilities_version: 1`) and declare typed defaults and maxima for inventory counts, export counts, batch bytes, and individual record size. The CLI enforces these v1 values: inventory defaults to 100 contexts and permits at most 500; export defaults to 100 records and permits at most 500; default and maximum batch budgets are 1,000,000 and 4,000,000 bytes; an individual record may be at most 3,000,000 bytes. A record that cannot fit the requested budget is rejected rather than split.

Use `agent-validator metrics capabilities` to negotiate protocol and measurement versions before retrieval. Consumers locate a scope through `metrics pending`, export a bounded receipt-scoped batch, durably save the complete replacement records, and then acknowledge that receipt. `metrics discard --confirm` records a visible `user_discarded` delivery gap for the previewed receipt; it is never a successful acknowledgment or a zero-usage claim. Retrying the same receipt operation is safe. Recovery requires the original project/configuration location; moved or deleted private storage is reported as unavailable rather than reconstructed from logs.

The private `storage_version` is also `1`, but is intentionally not a consumer contract. Receipt transactions, store persistence, and command publication are outside this pure contract layer.
