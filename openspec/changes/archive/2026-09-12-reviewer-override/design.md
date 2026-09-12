## Context

Reviewer identity for `run` / `review` is owned by the tracked project file: `cli.default_preference`, per-review `cli_preference`, and `cli.adapters`. Agent Runner will later export a `{cli, model, effort}` triple through inherited environment. This change is the Validator slice: apply that triple in memory on overlay commands, advertise support on `metrics capabilities`, and name the configured identity when the overlay ran.

`loadConfig()` is shared. `check` and `review` both enter through `src/commands/gate-command.ts`. Overlay cannot be unconditional. Preference replacement must run **before** `mergeCliPreferences` in `src/config/loader.ts`, which rejects a review CLI outside `cli.default_preference`. Init adapter defaults already live in `src/commands/init-config-helpers.ts` (`ADAPTER_CONFIG`). Capabilities JSON is emitted in `src/commands/metrics.ts` with `capabilities_version` `1`. Current Runner's probe requires that version and ignores unknown keys (`agent-runner/internal/exec/validator_launch.go`). Stderr summary is `ConsoleReporter.printSummary`; `--report` is `generateReport` (also used on the trusted short-circuit). Trust lookup is unchanged.

## Goals / Non-Goals

**Goals:**

- Opt-in overlay at config load so `run` / `review` / `health` / `list` / `detect` share one mapped adapter without writing `.validator/config.yml`.
- Fail closed on overlay commands before lock, reconciliation, or gates when the env is a malformed override.
- Reuse init adapter defaults for a missing mapped `cli.adapters` block; never copy `allow_tool_use` from the displaced adapter.
- Advertise `reviewer_override.supported` on capabilities v1; report configured identity only when overlay applied.

**Non-Goals:**

- Runner env export, setup UI, or fail-closed probe (other than emitting the flag Validator already owns).
- Trust-ledger matching, `config_hash` gating, or changing when a commit is trusted.
- List-valued reviewer, `--config`, user-level `cli:` block, Agent Skills text, metrics delivery/measurement version bumps.
- A `project-config` report line when no override is present.

## Approach

```text
overlay command? ──no──► loadConfig()                 ► tracked file only
        │ yes
        ▼
loadConfig({ applyReviewerOverride: true })
        │
        ├─ parse YAML as today
        ├─ parseReviewerOverrideEnv()
        │     none set → no overlay, continue
        │     any set, CLI missing/unmapped/bad effort → throw
        ├─ map copilot→github-copilot, xhigh→high
        ├─ replace default_preference + every cli_preference
        ├─ overlay/create cli.adapters.<mapped> (keep allow_tool_use)
        ├─ mergeCliPreferences()
        └─ attach config.reviewerOverride { source, adapter, effortCollapsed? }
                │
                ▼
        run / review / health / list / detect
                │
                ├─ printSummary / generateReport if reviewerOverride set
                └─ dispatch uses overlaid lists; health skip rules unchanged
```

### `src/config/reviewer-override.ts`

Pure env parse + mapping. Trim whitespace; empty after trim is absent. Activation = any of `AGENT_VALIDATOR_REVIEWER_CLI`, `_MODEL`, `_EFFORT` present. Then CLI must be non-empty and in `{claude, codex, cursor, opencode, copilot}`. Effort if present must be `low` | `medium` | `high` | `xhigh`. Throw a small dedicated error type (message names the variable and the problem) so CLI wrappers keep today's nonzero config-error exit. Do not read env again at report time.

### `loadConfig({ applyReviewerOverride?: boolean })`

Default `false`. When `true`, after schema parse and inline-gate extraction, before `mergeCliPreferences`:

1. If parse returns inactive, load as today.
2. If parse throws, do not merge, do not return config, do not acquire the run lock.
3. Replace `project.cli.default_preference` and every `reviews[name].cli_preference` with `[mappedAdapter]`.
4. Overlay adapter policy: if `project.cli.adapters[mapped]` exists, keep `allow_tool_use`; set `model` when the role provided one; set `thinking_budget` when the role provided effort. If the block is missing, copy init defaults from exported `ADAPTER_CONFIG` in `init-config-helpers.ts` (or a shared module that both import), then apply role model/effort. Role model wins over per-review YAML `model` because dispatch uses `adapterCfg?.model ?? config.model`.
5. Set `LoadedConfig.reviewerOverride` when overlay applied (`effortCollapsed: 'xhigh'` only when that mapping happened).

### Call sites

| Site | `applyReviewerOverride` |
| --- | --- |
| `executeRun` | `true` |
| `gate-command` `initializeDebugLogger` | `commandName === 'review'` |
| `health`, `list`, `detect` | `true` |
| `check` (same gate-command), `validate`, `clean`, `skip`, `update-review`, `ci/list-jobs` | omit / `false` |

Metrics commands do not call `loadConfig` for capabilities; do not parse reviewer env there.

### Capabilities

Keep `CAPABILITIES_VERSION = 1`. Add to the capabilities stdout object:

```json
"reviewer_override": { "supported": true }
```

Update `contracts/validator-metrics/v1/capabilities.schema.json` (`additionalProperties: false`, so the property must be declared; required). Update `src/metrics/validation.ts` `capabilitiesSchema` if tests parse this document. Update packaged fixtures/README. Do not bump measurement, protocol, or artifact versions.

### Report

If `config.reviewerOverride` is set:

- `ConsoleReporter.printSummary`: after `Status: …`, print `Reviewer: <adapter> (runner-reviewer-role)` and, when collapsed, `; effort xhigh→high` on the same line or the next.
- `generateReport`: same identity line after the status line, including trusted short-circuit which already calls `generateReport('trusted', …)`. Do not add a RESULTS SUMMARY to the trusted path if it does not already print one.

Exact line:

```text
Reviewer: github-copilot (runner-reviewer-role)
Reviewer: claude (runner-reviewer-role; effort xhigh→high)
```

### Tests

- Parser: trim, any-var activation, CLI required, unknown CLI/effort, copilot, xhigh, case-sensitive `Copilot`.
- Overlay: preference replacement before merge (pinned other CLI does not throw); `num_reviews: 2` → two slots of one adapter; keep `allow_tool_use`; missing block uses init defaults; displaced adapter policy not copied.
- Commands: `check`/`validate` ignore malformed env; `run`/`review`/`health`/`list`/`detect` throw before gates; config file bytes unchanged.
- Capabilities JSON includes the flag with no project and with env set or unset.
- `--report` and stderr summary get the line only when overlay applied.

## Decisions

- **Opt-in `loadConfig` flag, not a post-load overlay.** Merge must see the replaced lists. Default false so a missed call site cannot overlay `validate` or `check`.
- **Identity on `LoadedConfig`, not a second env read.** Report, `list`, and `health` share one parse result.
- **Export init `ADAPTER_CONFIG` rather than duplicate.** Init defaults are the policy source in the spec.
- **Throw from load, same as missing config.yml.** No Result type; fail before lock.
- **Capabilities v1 additive field.** Required in the schema we ship; documented closed-schema exception. Current Runner ignores the key.
- **No trust changes.** Overlay still runs before reconciliation so invalid env fails even on a trusted HEAD; a valid overlay on a trusted HEAD still short-circuits as today.

## Risks / Trade-offs

- **Default-false flag vs default-apply.** False is safer; every overlay command must pass true. `gate-command` is the easy-to-miss site (`review` vs `check`).
- **Closed capabilities v1.** Consumers validating the old schema reject the new document. Current Runner does not. Update fixtures in this change.
- **Trusted HEAD + valid overlay.** Reviews still skipped. Same as editing `cli.default_preference` today. `--report` still names the configured identity because `generateReport` runs.

## Migration Plan

Ship Validator first. Existing Runner keeps working (unknown JSON key). New Runner later requires `reviewer_override.supported` and sets the env. No config file migration. Rollback is reverting the binary; tracked YAML never changed.

## Open Questions

None. Report wording is specified above.
