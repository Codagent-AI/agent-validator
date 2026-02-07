## Context

Agent Gauntlet supports multiple AI CLI adapters (Claude, Codex, Gemini) for code reviews. Currently, tool use and thinking/reasoning budgets are hardcoded per adapter. Gemini reviews with tools enabled are expensive (~35k+ baseline tokens), and there is no way to tune reasoning effort per adapter.

Each adapter has a different mechanism for controlling these settings:

| Setting | Claude | Codex | Gemini |
|---------|--------|-------|--------|
| **Disable tools** | `--tools ""` | `--disable shell_tool` | Remove `--allowed-tools` arg |
| **Thinking budget** | `MAX_THINKING_TOKENS=N` env var (0=off, 1024-31999) | `-c model_reasoning_effort="level"` (minimal/low/medium/high/xhigh) | `thinkingConfig.thinkingBudget=N` via `.gemini/settings.json` (0-24576) |

**Key constraint**: Gemini has no CLI flag for thinking budget - it must be set via a project-level `.gemini/settings.json` file.

## Goals / Non-Goals

- **Goals:**
  - Allow per-adapter `allow_tool_use` and `thinking_budget` configuration in `config.yml`
  - Use a unified level abstraction (`off`/`low`/`medium`/`high`) mapped to adapter-specific values
  - Thread adapter config from project config through the review execution pipeline
  - Handle Gemini's settings.json constraint safely with backup/restore

- **Non-Goals:**
  - Per-review adapter overrides (future work; this change is project-level only)
  - Custom tool lists per adapter (only enable/disable all tools)
  - Max-turns configuration (stays hardcoded at current values)

## Decisions

### Unified thinking budget levels

**Decision**: Use string levels (`off`, `low`, `medium`, `high`) instead of raw numeric values.

**Rationale**: Each adapter maps thinking budget differently (env var, CLI flag, JSON file) with different numeric ranges. A unified level abstraction keeps config simple and prevents invalid cross-adapter values.

**Mapping**:

| Level | Claude (`MAX_THINKING_TOKENS`) | Codex (`model_reasoning_effort`) | Gemini (`thinkingBudget`) |
|-------|------|-------|--------|
| `off` | 0 | `"minimal"` | 0 |
| `low` | 8000 | `"low"` | 4096 |
| `medium` | 16000 | `"medium"` | 8192 |
| `high` | 31999 | `"high"` | 24576 |

**Alternatives considered**:
- Raw numeric values per adapter — rejected; too easy to misconfigure, leaks adapter internals
- Adapter-specific config sections — rejected; adds schema complexity without benefit

### Config location: project-level `cli.adapters`

**Decision**: Place adapter config under `cli.adapters` in `.gauntlet/config.yml`, keyed by adapter name.

```yaml
cli:
  default_preference: [claude, codex, gemini]
  adapters:
    claude:
      allow_tool_use: true
      thinking_budget: high
    codex:
      allow_tool_use: true
      thinking_budget: high
    gemini:
      allow_tool_use: false
      thinking_budget: high
```

**Rationale**: Adapter settings are project-level concerns (cost, quality trade-offs). Placing them under `cli` groups them with the existing `default_preference` setting. Using adapter names as keys is natural and extensible.

### Gemini thinking budget: temporary settings.json

**Decision**: Write a temporary `.gemini/settings.json` before Gemini execution and restore the original (or clean up) in a `finally` block.

**Rationale**: Gemini CLI has no flag for thinking budget. The settings file is the only mechanism. Backup/restore ensures no persistent side effects.

**Implementation**: A private `applyThinkingSettings(budget)` method on the Gemini adapter that:
1. Reads existing `.gemini/settings.json` (if any) as backup
2. Merges `thinkingConfig.thinkingBudget` into the settings
3. Writes the merged file
4. Returns a cleanup function that restores the original or removes the file

### Shared thinking budget module

**Decision**: Create `src/cli-adapters/thinking-budget.ts` with exported `Record<string, number|string>` maps.

**Rationale**: Centralizes the level-to-value mappings. Each adapter imports only its own map. ~20 lines, no abstractions.

### Threading adapter config through the pipeline

**Decision**: Pass `this.config.project.cli?.adapters` from `runner.ts` to `review.ts`, then look up the adapter-specific config by tool name when calling `adapter.execute()`.

**Rationale**: Minimal surface area change. The adapter config is resolved at the call site in `runSingleReview()` where the adapter name is already known.

### Dynamic args construction in adapters

**Decision**: Replace hardcoded args arrays and command strings with dynamic construction based on `opts.allowToolUse` and `opts.thinkingBudget`. Also refactor `execAsync` fallback paths to build command strings from the args array rather than duplicating hardcoded strings.

**Rationale**: The current code duplicates args in two places (streaming path and execAsync path). Dynamic construction from a single args array eliminates this duplication and makes the new config-driven behavior consistent across both paths.

## Pre-factoring

Two files that this change will modify are CodeScene hotspots:

### `src/gates/review.ts` — Code Health: 7.2

**Code smells identified:**
- **Bumpy Road Ahead** (severity 3): `getDiff` (lines 910-1017) has 3 bumps of nested conditional logic
- **Complex Method** (severity 2): `getDiff` (cc=25), `validateAndReturn` (cc=15), `evaluateOutput` (cc=11)
- **Large Method** (severity 2): `getDiff` is 95 lines (recommended max: 70)
- **Primitive Obsession** (severity 2): 68% of functions use primitive type arguments

**Pre-factoring strategy**: This change only modifies the `execute()` and `runSingleReview()` methods — it does not touch `getDiff`, `validateAndReturn`, or `evaluateOutput`. The modification is additive (accepting a new parameter and passing it through). No pre-factoring of the existing hotspot functions is required for this change since the change does not interact with the complex code paths.

### `src/core/runner.ts` — Code Health: 8.37

**Code smells identified:**
- **Bumpy Road Ahead** (severity 3): `calculateStats` (lines 51-85) has 2 bumps of nested conditional logic
- **Deep Nested Complexity** (severity 3): `calculateStats` reaches nesting depth of 4
- **Complex Method** (severity 2): `calculateStats` (cc=14), `executeJob` (cc=12)

**Pre-factoring strategy**: This change adds a single additional parameter to the `reviewExecutor.execute()` call in `executeJob`. It does not add branching or complexity. No pre-factoring required.

## Risks / Trade-offs

1. **Gemini settings.json restoration** — If the process crashes between write and restore, stale settings remain in `.gemini/settings.json`. Mitigated by try/finally. Low probability since the Gemini CLI usually completes or times out cleanly.

2. **Codex `--disable shell_tool`** — May have no observable effect in read-only sandbox mode since Codex already doesn't use tools for review tasks. Harmless but possibly a no-op.

3. **Gemini with `allow_tool_use: false`** — Becomes a diff-only reviewer (~35k baseline tokens). Quality may decrease for complex diffs. This is the intended trade-off per the cost-optimization goal.

4. **No per-review overrides** — Adapter config is project-level. A future change could add per-review `adapter_overrides` in review frontmatter, but this is intentionally out of scope.

## Open Questions

None — all mechanisms have been researched and validated via CLI documentation.
