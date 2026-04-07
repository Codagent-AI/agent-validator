# Intelligent Model Resolution for Cursor & GitHub Copilot

## Problem

The `model` parameter flows through the entire system (config schema, review gate executor, adapter interface) but every adapter ignores it. Users can't control which LLM their reviews run on. Cursor defaults to whatever is in `~/.cursor/cli-config.json`, and GitHub Copilot uses its built-in default.

## Solution

Add a `model` config setting per adapter (e.g. `model: codex`) that resolves at runtime to the highest-versioned available model matching that base name. The `thinking_budget` setting drives whether a thinking variant is selected.

## Config Schema

Add `model` as an optional string to `adapterConfigSchema`:

```typescript
export const adapterConfigSchema = z.object({
  allow_tool_use: z.boolean().default(true),
  thinking_budget: z.enum(["off", "low", "medium", "high"]).optional(),
  model: z.string().optional(),  // e.g. "opus", "codex", "sonnet"
});
```

When `model` is absent, no `--model` flag is passed — today's behavior, no breaking change.

## Example Config

```yaml
cli:
  default_preference:
    - cursor
    - github-copilot
  adapters:
    cursor:
      allow_tool_use: false
      thinking_budget: low
      model: codex
    github-copilot:
      allow_tool_use: false
      thinking_budget: low
      model: codex
```

## Model Resolution Logic

Each adapter gets an internal `resolveModel(baseName, thinkingBudget)` method:

1. **Query available models** — Cursor: `agent --list-models`; Copilot: parse `copilot --help` output for `--model` choices
2. **Filter** to models whose ID contains the base name as a complete hyphen-delimited segment (e.g. `"codex"` matches `gpt-5.3-codex` but NOT `gpt-5.3-codecx`)
3. **Exclude** quality-tier variants (`-low`, `-high`, `-xhigh`, `-fast`) — select the standard tier only
4. **Select thinking variant** — if `thinking_budget` is set and not `"off"`, prefer the `-thinking` variant (Cursor only; Copilot has no thinking variants)
5. **Sort by version** descending, pick the highest
6. **Fallback** — if query fails or no match found, log a warning and proceed without `--model` flag

### Resolution Example

Config: `model: codex`, `thinking_budget: low`, adapter: Cursor

- Available: `gpt-5.3-codex`, `gpt-5.3-codex-low`, `gpt-5.3-codex-high`, `gpt-5.2-codex`, ...
- Filter to "codex" matches, exclude tier variants -> `gpt-5.3-codex`, `gpt-5.2-codex`
- No thinking variant for codex models
- Pick highest: `gpt-5.3-codex`
- CLI command: `agent --trust --model gpt-5.3-codex`

### Resolution Example (thinking)

Config: `model: opus`, `thinking_budget: high`, adapter: Cursor

- Available: `opus-4.6`, `opus-4.6-thinking`, `opus-4.5`, `opus-4.5-thinking`
- Filter to "opus" matches, exclude tier variants -> all match
- `thinking_budget` is `high` (not off) -> prefer `-thinking` variants -> `opus-4.6-thinking`, `opus-4.5-thinking`
- Pick highest: `opus-4.6-thinking`
- CLI command: `agent --trust --model opus-4.6-thinking`

## Adapter Changes

### Cursor (`cursor.ts`)

- Add `resolveModel()` that calls `agent --list-models` and parses output (format: `id - Display Name`)
- In `execute()`, if `opts.model` is set, resolve and append `--model <resolved>` to args
- On resolution failure: warn and omit `--model`

### GitHub Copilot (`github-copilot.ts`)

- Add `resolveModel()` that calls `copilot --help` and parses the `--model` choices list
- In `execute()`, if `opts.model` is set, resolve and append `--model <resolved>` to args and exec command string
- Copilot has no thinking variants — `thinking_budget` only affects thinking variant filtering (no-op here)
- On resolution failure: warn and omit `--model`

### Config Schema (`schema.ts`)

Add `model` as an optional string to `adapterConfigSchema`. The `model` field already exists in `CLIAdapterExecuteOpts` and is passed from `ReviewGateExecutor` to `adapter.execute()` — this change adds it to the per-adapter config so users can set a base model name per adapter in `config.yml`.

### CLIAdapter Interface (`index.ts`)

No interface change needed. `model` already flows through `execute(opts)` via `CLIAdapterExecuteOpts`. Resolution is internal to each adapter.

## Init Scaffolding

Update `ADAPTER_CONFIG` in `init.ts`:

```typescript
const ADAPTER_CONFIG = {
  claude:           { allow_tool_use: false, thinking_budget: "high" },
  codex:            { allow_tool_use: false, thinking_budget: "low" },
  gemini:           { allow_tool_use: false, thinking_budget: "low" },
  cursor:           { allow_tool_use: false, thinking_budget: "low",  model: "codex" },
  "github-copilot": { allow_tool_use: false, thinking_budget: "low",  model: "codex" },
};
```

Update `AdapterCfg` type and `buildAdapterSettingsBlock()` to include `model` when present.

## Flow

```
config.yml -> adapter.model = "codex"
                    |
ReviewGateExecutor passes opts.model to adapter.execute()
                    |
adapter.execute() calls this.resolveModel("codex", opts.thinkingBudget)
                    |
resolveModel():
  1. query CLI for available models
  2. filter by base name
  3. exclude tier variants (-low, -high, -xhigh, -fast)
  4. if thinking_budget && !off -> prefer -thinking variant
  5. sort by version, pick highest
  6. on failure -> warn, return undefined
                    |
if resolved -> append --model <resolved> to CLI command
if not      -> no flag, CLI uses its own default
```

## Not In Scope

- Claude, Codex, Gemini adapters — unchanged
- No new CLI commands or flags for agent-validator itself
- No caching of model lists
- No changes to the `model` field in review prompt frontmatter (that's a separate path)
