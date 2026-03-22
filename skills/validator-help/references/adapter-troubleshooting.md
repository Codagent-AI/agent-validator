# Adapter Troubleshooting

## `agent-validator health` Output

Run `agent-validator health` to check adapter status. Each adapter reports one of:

| Status | Meaning |
|--------|---------|
| `healthy` | Binary found and available |
| `missing` | Binary not found in PATH |
| `unhealthy` | Binary found but not functional (auth issue, etc.) |

## Missing CLI Tools

If an adapter reports `missing`:
1. Verify the tool is installed
2. Check that it's in your PATH: `which claude`, `which gemini`, `which codex`
3. If installed but not in PATH, add the installation directory to your PATH

Missing adapters are skipped during review gate dispatch with a "Skipping X: Missing" message.

## Authentication Issues

If an adapter reports `unhealthy`:
1. Check the tool's authentication: try running the CLI tool directly
2. For Claude: `claude --version` (may need `claude login`)
3. For Gemini: check Google Cloud authentication
4. For Codex: check OpenAI authentication

## Usage Limits and 1-Hour Cooldown

### How Usage Limits Are Detected
The gauntlet checks adapter output for these keywords:
- "usage limit"
- "quota exceeded"
- "quota will reset"
- "credit balance is too low"
- "out of extra usage"
- "out of usage"

### Cooldown Mechanism
When a usage limit is detected:
1. The adapter is marked **unhealthy** in `.execution_state`
2. A **1-hour cooldown** starts (60 minutes)
3. During cooldown, the adapter is skipped for review dispatch
4. After cooldown expires, the adapter is re-probed and cleared if available

### Checking Cooldown Status
Read `<log_dir>/.execution_state` and look at the `unhealthy_adapters` field:

```json
{
  "unhealthy_adapters": {
    "claude": {
      "marked_at": "2025-01-15T10:30:00.000Z",
      "reason": "Usage limit exceeded"
    }
  }
}
```

- `marked_at`: When the cooldown started (ISO 8601)
- Cooldown expires 60 minutes after `marked_at`

### All Adapters in Cooldown
If every configured adapter is in cooldown, review gates will fail with "no healthy adapters". Wait for the cooldown to expire or resolve the usage limit.

## `cli.default_preference` and Adapter Selection

The `cli.default_preference` array in `config.yml` determines:
1. **Which adapters are available** for review dispatch
2. **Selection order** for round-robin assignment

Review gates can override with `cli_preference` but those tools must also be in `default_preference`.

```yaml
cli:
  default_preference:
    - claude
    - gemini
```

## `allow_tool_use` and `thinking_budget` Settings

Per-adapter settings in `config.yml`:

```yaml
cli:
  adapters:
    claude:
      allow_tool_use: true      # Whether the adapter can use tools during review
      thinking_budget: medium    # off, low, medium, high
```

### `thinking_budget` Token Mapping

| Level | Claude | Codex | Gemini |
|-------|--------|-------|--------|
| `off` | 0 | minimal | 0 |
| `low` | 8,000 | low | 4,096 |
| `medium` | 16,000 | medium | 8,192 |
| `high` | 31,999 | high | 24,576 |

## `.execution_state` File

The `.execution_state` file in `<log_dir>/` tracks run context:

```json
{
  "last_run_completed_at": "2025-01-15T10:30:00.000Z",
  "branch": "feature/my-branch",
  "commit": "abc123",
  "working_tree_ref": "def456",
  "unhealthy_adapters": {}
}
```

| Field | Purpose |
|-------|---------|
| `last_run_completed_at` | When the last successful run finished |
| `branch` | Git branch at last completion |
| `commit` | HEAD SHA at last completion |
| `working_tree_ref` | Stash SHA of working tree (used for rerun diff scoping) |
| `unhealthy_adapters` | Map of adapter name to cooldown info |

This file is:
- Written after successful execution
- Preserved across runs
- Auto-cleaned when the branch changes or commit is merged
- Deleted by `agent-validator clean`

## Troubleshooting Checklist

1. **Run `agent-validator health`** to see overall adapter status
2. **Check `.execution_state`** for cooldown entries
3. **Verify `cli.default_preference`** includes the adapters you expect
4. **Try the CLI tool directly** (e.g., `claude --version`) to isolate the issue
5. **Check for usage limit messages** in review logs (`review_*.log`)
