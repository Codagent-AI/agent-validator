# Lock Troubleshooting

## `lock_conflict` — Another Run in Progress

The gauntlet uses a lock file to prevent concurrent runs from interfering with each other.

### Lock File Details
- **File**: `<log_dir>/.gauntlet-run.lock`
- **Content**: PID of the process holding the lock
- **Created**: At the start of a gauntlet run (exclusive write — fails if file exists)
- **Released**: Always in a `finally` block (guaranteed cleanup on success, failure, or error)

### Diagnosing Lock Conflicts

1. Check if the lock file exists: `<log_dir>/.gauntlet-run.lock`
2. Read the PID from the file
3. Check if that process is alive:
   - If alive: a gauntlet run is genuinely in progress — wait for it to finish
   - If dead: the lock is stale (see below)

## Stale Lock Detection

The gauntlet automatically detects and cleans stale locks:

| Condition | Detection | Action |
|-----------|-----------|--------|
| PID is dead | `kill(pid, 0)` fails with ESRCH | Lock removed, retry once |
| PID unparseable, lock > 10 min old | File age check | Lock removed, retry once |
| PID alive | Process exists | Lock kept (genuine conflict) |

**The gauntlet never steals a lock from a live process**, regardless of lock age.

## `allow_parallel` Config

The `allow_parallel` config setting (default: `true`) controls whether gates can run in parallel **within** a single gauntlet run. It does **not** control concurrent gauntlet runs — that's what the lock file prevents.

## Marker Files

### `.gauntlet-run.lock`
- **Location**: `<log_dir>/.gauntlet-run.lock`
- **Purpose**: Prevent concurrent gauntlet runs
- **Lifecycle**: Created at run start, removed at run end (always in `finally`)

### `.stop-hook-active`
- **Location**: `<log_dir>/.stop-hook-active`
- **Purpose**: Prevent stop-hook recursion (see stop-hook-troubleshooting.md)
- **Content**: PID of the stop-hook process
- **Stale threshold**: 10 minutes
- **Lifecycle**: Created before stop-hook execution, removed after (always in `finally`)

## Manual Cleanup

If a lock is stuck and the process is dead:

```bash
bun src/index.ts clean
```

This command:
1. Archives current logs to `<log_dir>/previous/`
2. Removes the lock file
3. Removes the stop-hook marker file
4. Resets execution state

**Confirm with the user before running `clean`** — it archives all current logs and resets state, which means the next run starts fresh (no rerun mode).

## Troubleshooting Checklist

1. **Is another run actually in progress?** Check the PID in the lock file.
2. **Is the process alive?** The gauntlet should auto-clean stale locks on retry.
3. **Did a crash leave a stale lock?** Run `bun src/index.ts clean` to reset.
4. **Is this happening repeatedly?** Check for processes spawning concurrent gauntlet runs (e.g., multiple IDE hooks firing simultaneously).
