## Context

The `github-copilot` adapter currently uses the standalone `copilot` binary, returns `null` for all skill/command directories, has no plugin lifecycle, and is review-only. The Copilot CLI is now GA (v1.0.11) with full agent capabilities accessible via `gh copilot`.

POC testing confirmed:
- `gh copilot -- <flags>` works for all operations
- Stdin piping works without `-p` flag: `cat file | gh copilot -- -s --allow-tool ...`
- Plugin install/uninstall works: `gh copilot -- plugin install Codagent-AI/agent-validator`
- Plugin state tracked in `~/.copilot/config.json` under `installed_plugins` array
- `--effort` flag replaces thinking budget (`low/medium/high/xhigh`)
- `--model` takes free-form model names (no `--list-models` or help-parsed choices exist)
- `-s` (silent) flag provides clean output for scripting

## Goals / Non-Goals

**Goals:**
- Update adapter to invoke via `gh copilot --` with verified flag surface
- Add skill directories (`.github/skills/`, `~/.copilot/skills/`)
- Implement plugin lifecycle via a new `copilot-cli.ts` module
- Add `github-copilot` to `NATIVE_CLIS` in init
- Map `thinkingBudget` config to `--effort` flag

**Non-Goals:**
- MCP server configuration (future work)
- Custom agent definitions for Copilot
- Changing the adapter registry name (stays `github-copilot`)
- Adding a `.github/plugin/plugin.json` manifest (rely on `.claude-plugin/`)
- Model resolution/listing (Copilot takes free-form model names, no resolution needed)

## Decisions

**D1: Invocation via `gh copilot --`**
All commands use `gh copilot --` prefix to prevent `gh` from intercepting flags. Verified working in POC.
- Execution: `cat tmpFile | gh copilot -- -s --allow-tool 'shell(cat)' --allow-tool 'shell(grep)' ...`
- Plugin ops: `gh copilot -- plugin install Codagent-AI/agent-validator`
- Health check: `gh copilot -- --help`

**D2: Stdin piping without `-p` flag**
The adapter pipes prompt+diff via stdin. The `-p` flag is for inline prompts and does NOT read from stdin. POC confirmed: `cat file | gh copilot -- -s` works correctly. The `-s` (silent) flag suppresses UI/stats for clean output.

**D3: Model pass-through (no resolution)**
The old adapter parsed `copilot --help` for model choices. The new Copilot CLI accepts free-form `--model <name>` with no discovery mechanism. The adapter will pass the configured model name directly to `--model`. Invalid models produce a clear error (`Error: Model "..." is not available`). The `resolveModel()` private method and `parseCopilotModels()` function are removed.

**D4: Thinking budget maps to `--effort` flag**
Copilot uses `--effort` (`low`, `medium`, `high`, `xhigh`) instead of thinking tokens. Mapping from adapter config:
- `thinkingBudget: 'off'` → no `--effort` flag
- `thinkingBudget: 'low'` → `--effort low`
- `thinkingBudget: 'medium'` → `--effort medium`
- `thinkingBudget: 'high'` → `--effort high`

**D5: Tool restriction with `--allow-tool`**
Same pattern as the current adapter. For reviews with `allowToolUse: true`:
```
--allow-tool 'shell(cat)' --allow-tool 'shell(grep)' --allow-tool 'shell(ls)' --allow-tool 'shell(find)' --allow-tool 'shell(head)' --allow-tool 'shell(tail)'
```
For `allowToolUse: false`: no `--allow-tool` flags. Also tested `--available-tools` which restricts the tool set entirely — this is a stronger restriction but may break if Copilot needs internal tools. Stick with `--allow-tool` for now.

**D6: New `src/plugin/copilot-cli.ts` module**
Mirrors `claude-cli.ts`. Exports:
- `installPlugin()` — runs `execFileSync('gh', ['copilot', '--', 'plugin', 'install', 'Codagent-AI/agent-validator'])`
- `detectPlugin()` — reads `~/.copilot/config.json`, parses `installed_plugins` array, checks for `name === 'agent-validator'` or `name === 'agent-gauntlet'`
- `uninstallPlugin()` — not needed for init, but available for future use

Plugin detection via `config.json` is more reliable than filesystem scanning. POC confirmed the structure:
```json
{
  "installed_plugins": [
    {
      "name": "agent-validator",
      "version": "1.4.0",
      "cache_path": "~/.copilot/installed-plugins/_direct/Codagent-AI--agent-validator",
      "source": { "source": "github", "repo": "Codagent-AI/agent-validator" }
    }
  ]
}
```

**D7: Plugin detection returns `'user'` only**
Copilot plugins install globally to `~/.copilot/installed-plugins/`. There is no project-scope plugin concept. `detectPlugin()` returns `'user'` if found, `null` otherwise. The `scope` parameter in `installPlugin()` is accepted for interface compatibility but ignored — Copilot always installs to user scope.

**D8: `NATIVE_CLIS` and `ADAPTER_CONFIG` updates in init.ts**
- Add `'github-copilot'` to the `NATIVE_CLIS` set so post-init instructions show `/validator-setup`
- The existing `ADAPTER_CONFIG['github-copilot']` entry stays as-is (already configured)
- Copilot joins the `detectAdaptersNeedingInstall` → `installAdapterPlugin` pipeline since it now has `installPlugin()`

**D9: Availability check via `gh copilot -- --help`**
`isAvailable()` runs `gh copilot -- --help` (not `which copilot`). This verifies:
1. `gh` is installed
2. The copilot extension is available (auto-downloaded if needed on first run)
3. The copilot binary is functional

Uses a 10-second timeout to handle the auto-download case on first invocation.

## Risks / Trade-offs

- **First-run latency**: `gh copilot` auto-downloads the binary (~100MB) on first use. The 10s timeout in `isAvailable()` may be too short for initial download. Mitigation: the init flow prints "Detecting available CLI agents..." which sets expectations. If the download takes longer, Copilot simply won't appear in the available list and the user can re-run.
- **`config.json` format stability**: Plugin detection reads `~/.copilot/config.json` directly. If Copilot changes this format, detection breaks. Low risk — it's the canonical plugin state file.
- **No `--json` for plugin list**: `plugin list --json` is not supported, so we can't use structured output. Using `config.json` directly is more reliable anyway.
- **Scope parameter ignored**: `installPlugin(scope)` ignores the scope — Copilot always installs to user scope. This could confuse users who select "project" scope. Mitigation: the init flow already handles mixed scoping across adapters.

## Migration Plan

- No breaking changes — adapter registry name stays `github-copilot`
- Existing configs referencing `github-copilot` in `cli.default_preference` continue to work
- Users who had the standalone `copilot` binary will now need `gh` installed
- The old `parseCopilotModels()` and help-parsing model resolution are removed (dead code)

## Open Questions

None — all deferred-to-design items resolved by POC testing.
