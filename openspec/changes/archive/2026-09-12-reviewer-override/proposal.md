## Why

Agent Validator already sits on the critical path of `implement-change`, but who actually runs those reviews is owned by the project's tracked `.validator/config.yml`. Agent Runner setup owns the other agent identities (`lead`, `crosscheck`, `implementor`, `tester`). Changing the review CLI means editing a repo file by hand, not changing a Runner profile. That split makes setup feel incomplete: Codagent claims to own every agent, then leaves verification on a second control plane.

A user-level Validator `cli:` block would cover daily identity without a fifth Runner role. It is the wrong shape. It would not appear in native setup next to lead and implementor, would split the control plane, and would not give evaluations an independent Validator document. Those evals are a different knob (`validator_config` in Evals/Factory) and are out of this repository.

This change is the Validator slice of [Codagent-AI/agent-runner#69](https://github.com/Codagent-AI/agent-runner/issues/69). Runner will later export a `reviewer` role triple. Validator must accept that triple without rewriting the user's tracked config, fail closed on version skew, and make a global profile that disagrees with the project file visible in the run report.

**Verdict: go with caveats.** The problem is real and this repo is the right owner for the override contract. The caveats are install-order (Validator ships before Runner) and honest reporting of a lossy `xhigh` → `high` mapping and of collapsed multi-adapter panels.

## What Changes

- Accept a Runner reviewer triple through inherited environment. Ordinary Runner use does not rewrite `.validator/config.yml`.
- Advertise that this Validator understands the override on the existing `metrics capabilities` document. That command is already Runner's pre-launch handshake; this change reuses it as bootstrap feature detection, not as a metrics-schema or token-accounting change.
- Translate Runner CLI / model / effort into Validator adapter vocabulary. Unmapped CLI values are an error. `copilot` maps to `github-copilot`. `xhigh` maps to `high` and the collapse is reported.
- When the override is active, replace `cli.default_preference` and every review `cli_preference` with that single mapped adapter. Gates, checks, enablement, and `num_reviews` stay as configured. Multi-review panels become N runs of the one agent.
- Apply the adapter-policy rule: do not copy `allow_tool_use` from the displaced adapter. Keep the mapped adapter's existing `allow_tool_use`, or create the block from Validator init defaults (`allow_tool_use: false` plus documented init `thinking_budget` / `model`) and then overlay the role's model and mapped effort.
- When the override is active, name the configured review identity (`runner-reviewer-role`, mapped adapter, and a lossy `xhigh` collapse when it happened) in the stderr RESULTS SUMMARY and `--report` stdout. With no override, report output stays as it is today.

## Capabilities

### New Capabilities
- `reviewer-override`: Environment-inherited override of review-agent identity. Env contract, CLI/effort translation, in-memory preference-list replacement, adapter-policy overlay, fail-closed invalid input, command-selected overlay, and naming the configured review identity when the override is active.

### Modified Capabilities
- `nested-metrics-handoff`: The existing `metrics capabilities` document advertises reviewer-override support so Runner can fail closed on version skew. This is a bootstrap flag on the current handshake (`capabilities_version` remains `1`). Adding that field is an explicit exception to the closed v1 capabilities schema, not a metrics protocol, measurement, or artifact change. It does not change export, acknowledgment, or delivery.
- `report-flag`: When the override is active, `--report` stdout names the configured review identity so orchestrators see that a Runner role replaced the tracked project reviewers.

## Technical Approach

Load the project config as today. If no reviewer override environment is present, behavior and report output are unchanged. If the override is active, translate the triple, overlay adapter identity in memory on the commands that need it, then dispatch reviews against that overlay. The tracked file is not written.

```text
Runner reviewer triple (env)
        │
        ▼
  metrics capabilities  ── already probed; now also
        │                  reviewer_override.supported
        ▼
  Validator config load (unchanged files)
        │
        ├─ map cli/effort (copilot→github-copilot, xhigh→high)
        ├─ replace default_preference + every cli_preference
        ├─ overlay mapped adapter block (keep allow_tool_use)
        └─ if overlay command: report configured identity (+ xhigh collapse)
        │
        ▼
  gates / checks / enablement / num_reviews unchanged
```

**Handshake, not metrics.** `agent-validator metrics capabilities` is the probe Runner already runs before launch. Current Runner requires `capabilities_version == 1` and ignores unknown JSON keys. This change keeps version `1` and adds `reviewer_override: { supported: true }`. That is an explicit, bounded exception to the published closed v1 capabilities schema (`additionalProperties: false`): this envelope may grow additive bootstrap feature flags. It is not ordinary closed-schema evolution, and it is not a change to measurement, protocol, or artifact versions. The v1 schema and fixtures are updated to include the flag. Bumping `capabilities_version` would break today's Runner on the Validator-first ship order. A consumer pinned to the pre-change v1 schema would reject the new response; current Runner will not, because it ignores unknown keys. New Runner must treat a response without `reviewer_override.supported` as unsupported.

**Environment contract.** Validator owns the names it reads:

- `AGENT_VALIDATOR_REVIEWER_CLI`
- `AGENT_VALIDATOR_REVIEWER_MODEL`
- `AGENT_VALIDATOR_REVIEWER_EFFORT`

Presence of **any** of the three activates override mode. Once activated, CLI must be non-empty and a mapped adapter; otherwise the command errors. Model and effort remain optional: absent or empty means do not overlay that field. Unknown CLI or effort is a hard error. A partial or invalid override never silently falls back to project-config; that is the failure old Validator would hide.

**Translation**

| Runner field | Runner values | Validator field | Mapping |
| --- | --- | --- | --- |
| `cli` | `claude`, `codex`, `cursor`, `opencode` | adapter key | same string |
| `cli` | `copilot` | adapter key | `github-copilot` |
| `model` | string | adapter `model` | unchanged |
| `effort` | `low`, `medium`, `high` | `thinking_budget` | same string |
| `effort` | `xhigh` | `thinking_budget` | `high` (lossy; report the collapse) |
| — | — | `thinking_budget: off` | not expressible from the role |

**Preference replacement.** The overlay runs before `mergeCliPreferences` so a review that named another CLI does not fail the "outside `default_preference`" check. Those lists are replaced, not validated against the old project list.

**Adapter policy.** Per-adapter `allow_tool_use` (and any `thinking_budget` already on the displaced adapter) does not copy from the adapter being replaced. After mapping:

- If `cli.adapters.<mapped>` exists, keep that block's `allow_tool_use`. Apply the role's model and mapped `thinking_budget` on top.
- If it does not exist, create it from init defaults for that adapter, then apply the role's model and mapped `thinking_budget`.

Init defaults are used rather than schema defaults because the schema default for unspecified `allow_tool_use` is `true`. Switching to an adapter the project never configured must not enable tools by accident.

**Reporting.** Only when the override is active: the stderr RESULTS SUMMARY and `--report` stdout name the configured review identity (`runner-reviewer-role` and the mapped adapter). That is requested/configured identity, not telemetry-observed effective identity. When `xhigh` collapsed to `high`, that collapse is named too. With no override, do not add a `project-config` line. Delivery-gating requested-versus-effective telemetry is out of scope.

**Which commands overlay.** Overlay is a command-selected mode, not an unconditional `loadConfig()` side effect. `run`, `review`, `health`, `list`, and `detect` use the overlay so dispatch and “what would run” stay aligned, and so preference replacement still happens before `mergeCliPreferences`. `validate`, `check`, `clean`, `skip`, `update-review`, metrics operations, and CI job listing stay on the tracked project file so a bad reviewer env cannot break commands that do not choose a reviewer.

## Out of Scope

- Runner setup UI, profile recommendation, env *export*, and fail-closed probe implementation (agent-runner).
- Eval `validator_config` write, pre-score commit, and suppressing the override when that document is supplied (agent-evals).
- Factory intake allowlist for `reviewer` / `validator_config` (agent-factory).
- A user-level `cli:` block in `~/.config/agent-validator/config.yml`.
- Adding `--config` to Validator `run` / `check` / `review`.
- A list-valued `reviewer` role.
- Agent Skills text (`validator-run` and related). Environment inheritance is the contract that makes that omission safe.
- Rewriting the user's tracked `.validator/config.yml`.
- Delivery-gating requested-versus-effective telemetry.
- Changing measurement, protocol, or artifact schema versions; metrics export/acknowledgment/delivery.
- Trusted-snapshot lookup and reconciliation. A reviewer override does not change when a commit or tree is trusted. Same as editing `cli.default_preference` today.
- An always-on report line for `source=project-config` when no override is present.

## Impact

- **Config load / review dispatch:** in-memory overlay of `cli.default_preference`, per-review `cli_preference`, and the mapped `cli.adapters` block on overlay commands only. No on-disk config mutation.
- **Metrics capabilities JSON:** additive `reviewer_override` object on the existing v1 document and its published schema/fixtures, as a documented closed-schema exception. Current Runner continues to accept the probe.
- **Report output:** when the override is active, stderr summary and `--report` gain a configured-identity line. Existing status, check-failure, and violation sections stay compatible. No new line when the override is off.
- **Docs:** reviews/adapters and config reference describe the env contract, mapping table, overlay command set, and that a Runner profile can disagree with the tracked file.
- **Tests:** any-var activation and CLI-required fail-closed, mapping (including `copilot` and `xhigh`), preference replacement vs `mergeCliPreferences`, adapter-policy (existing block vs init defaults, no copied `allow_tool_use`), overlay vs non-overlay commands, capabilities advertisement, and override-only report lines.
- **Compatibility:** runs with no override env behave as today, including report output and trusted-snapshot behavior. `skip_validator` and check-only flows are unchanged in this repo.
- **Cross-repo:** Runner later sets the env on every Validator-capable process and refuses to treat the role as live unless `reviewer_override.supported` is advertised. That work is not implemented here. Runner also currently uses `reviewer` as a deprecated alias for `crosscheck`; renaming that role is Runner's problem, not this slice.
