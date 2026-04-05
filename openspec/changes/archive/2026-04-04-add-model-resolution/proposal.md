# Change: Add intelligent model resolution for Cursor and GitHub Copilot adapters

## Why

The `model` parameter exists in `CLIAdapterExecuteOpts` and is passed from `ReviewGateExecutor` to adapters, but every adapter ignores it. Meanwhile, the per-adapter config (`adapterConfigSchema`) has no `model` field, so users cannot control which LLM their reviews run on. Adding runtime model resolution lets users specify a base model name (e.g. `codex`, `opus`) per adapter and have the system automatically select the highest-versioned available model matching that name, with thinking variant selection driven by the existing `thinking_budget` setting.

## What Changes

- Add optional `model` string field to `adapterConfigSchema` (per-adapter config)
- Add `resolveModel()` logic to Cursor adapter: queries `agent --list-models`, filters by base name, excludes quality-tier variants, selects thinking variant when appropriate, picks highest version
- Add `resolveModel()` logic to GitHub Copilot adapter: queries `copilot --help` for `--model` choices, same filtering/sorting logic (no thinking variants for Copilot)
- Pass resolved `--model <id>` flag to CLI invocations when model is configured
- Graceful fallback: on resolution failure, warn and omit `--model` (preserves current behavior)
- Update init scaffolding to include `model: codex` default for Cursor and GitHub Copilot adapters

## Impact

- Affected specs: `review-config` (per-adapter config + model resolution), `init-config` (scaffold defaults)
- Affected code: `src/config/schema.ts`, `src/cli-adapters/cursor.ts`, `src/cli-adapters/github-copilot.ts`, `src/commands/init.ts`
- No breaking changes: when `model` is absent, behavior is identical to today
- Claude, Codex, and Gemini adapters are unchanged
- No separate `cli-adapters` spec exists; adapter-specific model resolution behavior is covered under `review-config` alongside the existing per-adapter configuration and thinking budget mapping requirements

## Alternatives Considered

1. **Direct model ID pass-through** — Users specify the exact model ID (e.g. `gpt-5.3-codex`) instead of a base name. Simpler to implement but brittle: users must update config every time a new model version is released. Rejected because the whole point is to auto-resolve to the latest available version.

2. **Static model mapping in config** — Maintain a hardcoded version map (e.g. `codex → gpt-5.3-codex`) that ships with agent-validator. Avoids runtime CLI queries but requires agent-validator releases to track upstream model changes. Rejected because querying the CLI at runtime is self-maintaining and always reflects the user's actual available models.

3. **No resolution, just pass-through** — Pass the configured string directly as `--model <value>` without any resolution. The CLI would either accept or reject it. Simplest option but provides no version auto-selection, no thinking variant selection, and poor error messages when the model name doesn't match an exact ID. Rejected because it doesn't solve the core problem of automatic version tracking.
