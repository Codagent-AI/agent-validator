# Metrics retrieval

Validator exposes retained measurement evidence through `agent-validator metrics`, not through private storage filenames. First run `metrics capabilities`, then use `metrics pending` to discover consumer contexts. Export with the original `--project`, optional `--config`, consumer, context, protocol version, and every measurement version the consumer supports.

Exports are bounded (100 records/1,000,000 bytes by default; 500 records/4,000,000 bytes maximum). Save every complete replacement record and its receipt durably before `metrics acknowledge`. Re-export and continue until the batch's `scope_complete` is true. It only describes pending revisions at that committed generation; it does not establish zero dispatch or guarantee that recording cannot add future revisions.

`metrics discard` is an operator recovery path: export first, then supply the exact receipt and `--confirm`. It leaves an explicit `user_discarded` delivery gap. Commands emit one JSON object on stdout. Retry `store_busy` responses; restore the original project/configuration or storage location for unavailable/corrupt storage. Do not run validation or cleanup merely to retrieve retained evidence.

## Evidence-preserving recovery

Metadata lock acquisition is bounded. An owner that is still alive (including a reused PID, or one whose liveness cannot be disproved because of permissions) is not automatically displaced. Incomplete owner metadata has a 30-second stale threshold; a recent incomplete lock is not proof of a dead owner. Retry busy operations after the owning process finishes. If busy responses persist, inspect the owner and stop all writers deliberately before attempting operator recovery. Do not delete a lock based only on elapsed time while a writer might still be active.

This first unreleased private storage format does not automatically migrate populated development stores that predate the committed revision index. Preserve such a store unchanged, including journals and payloads. Recover/export with a compatible producer on an isolated copy, or retain the copy for a separately reviewed migration. Scanning payload files cannot prove which revisions committed: orphan files may exist. Starting a new isolated log directory is suitable for development verification, but does not migrate or acknowledge the old evidence. Destructive reset is not required or performed automatically.

### Retry limit combined with an unindexed development store

If a run reports both `Retry limit exceeded` and `Unsupported unindexed metrics storage`, retry-limit cleanup could not finish. Repeating the run or increasing `max_retries` does not repair the storage incompatibility. A retry-limit exit before gate dispatch is not a fresh check or review result.

To resume development validation while preserving the old evidence:

1. Confirm that no validation or metrics operation is using the configured log directory. Coordinate other launchers before moving it; absence of a lock alone does not establish that all writers are stopped.
2. Move the **entire** log directory into a uniquely named, access-restricted backup outside the active log path, preferably on the same filesystem. Keep its execution state, archives, latest snapshot, private store, and closure journals together. Record the original project/configuration, backup location, and file hashes, and verify that the move preserved the files.
3. Keep `log_dir` configured as before. Run the current producer to create a fresh directory and actually execute the applicable gates. Do not copy the old execution state into the new directory or use `skip` to claim validation.
4. Retain the backup for compatible-producer recovery on a separate copy or a reviewed migration. Moving it is neither delivery acknowledgment nor discard; pending historical evidence remains unresolved and is not discoverable through the new store. An empty inventory in the new store does not establish zero historical consumption.

To reverse this operation, stop writers again, preserve any newly created log directory separately, and restore the complete backup to its original path. Do not merge the old and new stores. The restored unindexed store still requires a compatible producer.

Historical rotation recognizes `previous` and positive, canonically written safe-integer suffixes such as `previous.1`. Ambiguous names such as `previous.01` or `previous.0` stop rotation before it stages current logs. Preserve both directories if differently spelled names coexist; do not merge them or assume they represent the same session. Operator recovery should first make a recoverable backup and establish archive ownership/order. Zero retention does not rotate or delete pre-existing archives. Metrics-only export/acknowledgment remains independent of ordinary archive recovery for supported committed storage.
