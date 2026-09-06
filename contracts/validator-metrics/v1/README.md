# Validator metrics artifact contract v1

`validation-metrics.json` is the standalone snapshot shape. Its `artifact_schema_version` is `1`; record heads retain their own `measurement_schema_version`, and the root aggregate declares its separate aggregate measurement version. A set or maximum of record versions is not a conversion claim.

Capabilities are separately versioned (`capabilities_version: 1`) and declare typed defaults and maxima for inventory counts, export counts, batch bytes, and individual record size. Those fields describe valid relationships only; operational values are selected and enforced by the future metrics CLI.

The private `storage_version` is also `1`, but is intentionally not a consumer contract. Receipt transactions, store persistence, and command publication are outside this pure contract layer.
