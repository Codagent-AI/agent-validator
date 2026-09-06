# Metrics retrieval

Validator exposes retained measurement evidence through `agent-validator metrics`, not through private storage filenames. First run `metrics capabilities`, then use `metrics pending` to discover consumer contexts. Export with the original `--project`, optional `--config`, consumer, context, protocol version, and every measurement version the consumer supports.

Exports are bounded (100 records/1,000,000 bytes by default; 500 records/4,000,000 bytes maximum). Save every complete replacement record and its receipt durably before `metrics acknowledge`. Re-export and continue until the batch's `scope_complete` is true. It only describes pending revisions at that committed generation; it does not establish zero dispatch or guarantee that recording cannot add future revisions.

`metrics discard` is an operator recovery path: export first, then supply the exact receipt and `--confirm`. It leaves an explicit `user_discarded` delivery gap. Commands emit one JSON object on stdout. Retry `store_busy` responses; restore the original project/configuration or storage location for unavailable/corrupt storage. Do not run validation or cleanup merely to retrieve retained evidence.
