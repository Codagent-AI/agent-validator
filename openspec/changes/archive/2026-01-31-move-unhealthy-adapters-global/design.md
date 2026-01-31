## Context
Unhealthy adapter cooldowns are currently stored in the project log directory’s `.execution_state`. Manual `clean` deletes this file, so adapters that hit usage limits (e.g. Codex) are retried immediately. This defeats cooldown behavior and wastes review iterations. The fix is to store unhealthy adapter state globally instead of per project.

## Pre-factoring

CodeScene hotspot analysis for files modified by this change:

| File                                 | Score        | Status            |
| :----------------------------------- | :----------- | :---------------- |
| `src/utils/execution-state.ts:8`     | 9.38 (Green) | Healthy           |
| `src/gates/review.ts:878`            | 7.2 (Yellow) | Hotspot candidate |

**Hotspot details (`src/gates/review.ts:878`):**
- `src/gates/review.ts:878-ReviewGateExecutor.getDiff` — Bumpy Road, Complex Method (cc=25), Large Method (LoC=95)

**Strategy:** Before implementing global unhealthy adapter storage, refactor `ReviewGateExecutor.getDiff` to reduce branching and length (extract diff-source resolution and validation steps into helpers). This keeps new adapter-selection changes from further degrading a hotspot.

## Goals / Non-Goals
- Goals:
  - Persist unhealthy adapter cooldowns across projects and cleans.
  - Keep `.execution_state` limited to per-project run metadata.
  - Provide a stable, testable global storage path with env override.
- Non-Goals:
  - Synchronizing adapter health across machines or users.
  - Introducing complex locking, transactions, or a database.
  - Changing the cooldown duration or adapter selection algorithm.

## Decisions
- **Global state location**: Store unhealthy adapter state in the global config directory (`~/.config/agent-gauntlet/`), in a dedicated JSON file (e.g. `unhealthy_adapters.json`).
- **Env override for tests**: Add `GAUNTLET_GLOBAL_STATE_DIR` (directory override) so tests can write to a temp location without touching user config.
- **Separate utility module**: Create a new utility module (e.g. `src/utils/unhealthy-adapters.ts`) to own all unhealthy adapter persistence. `execution-state.ts` will no longer manage unhealthy adapter data.
- **Schema**: Use the existing map structure `{ unhealthy_adapters: { [adapterName]: { marked_at, reason } } }`.
- **Clean behavior**: `clean` should not clear the global unhealthy adapter state.

## Risks / Trade-offs
- **Global scope**: An adapter marked unhealthy in one project will be skipped in other projects until cooldown expires. This is intentional, but may surprise users.
- **No migration**: Existing per-project `unhealthy_adapters` entries in `.execution_state` are not automatically migrated. The first run after change may retry an adapter once before it’s re-marked.
- **Best-effort writes**: Without file locking, concurrent processes may race, but the latest write wins and the behavior is acceptable for cooldown tracking.

## Migration Plan
- No explicit migration. The global file is created on first unhealthy adapter write.
- Documentation will call out the new location and behavior.

## Open Questions
- None.
