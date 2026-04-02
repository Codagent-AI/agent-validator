# Config Troubleshooting

- [`no_config` — Missing Configuration](#no_config--missing-configuration)
- [YAML Syntax and Schema Errors](#yaml-syntax-and-schema-errors)
- [Common Misconfigurations](#common-misconfigurations)
- [`log_dir` Issues](#log_dir-issues)
- [`base_branch` Misconfiguration](#base_branch-misconfiguration)
- [Config Precedence](#config-precedence)
- [Init Setup Problems](#init-setup-problems)
- [Adapter Configuration](#adapter-configuration)
- [Debug Logging](#debug-logging)

## `no_config` — Missing Configuration

The `no_config` status is returned when `.validator/config.yml` doesn't exist. This is normal for non-gauntlet projects.

**If it should exist:**
1. Run `agent-validate init` to create the configuration
2. Or manually create `.validator/config.yml`

## YAML Syntax and Schema Errors

Run `agent-validate validate` to check config syntax and schema.

**Common YAML issues:**
- Indentation errors (YAML requires consistent indentation)
- Missing colons after keys
- Unquoted special characters in values

**Schema validation catches:**
- Missing required fields (`cli.default_preference`, `entry_points`)
- Wrong types (e.g., string where array expected)
- Invalid enum values (e.g., invalid `rerun_new_issue_threshold`)

## Common Misconfigurations

### Missing or Empty `cli.default_preference`
```yaml
# WRONG — missing
cli: {}

# WRONG — empty
cli:
  default_preference: []

# CORRECT
cli:
  default_preference:
    - claude
```

### Empty `entry_points`
```yaml
# WRONG
entry_points: []

# CORRECT
entry_points:
  - path: "."
    reviews:
      - code-quality
```

### `fail_fast` with `parallel`
These are mutually exclusive for check gates. Schema validation rejects this:
```yaml
# WRONG — in a check YAML file
parallel: true
fail_fast: true

# CORRECT — fail_fast only works with sequential
parallel: false
fail_fast: true
```

### Conflicting Fix Instruction Fields
Check gates support only one fix method. These are mutually exclusive:
- `fix_instructions` (inline string)
- `fix_instructions_file` (path to file)
- `fix_with_skill` (skill name)

### Entry Point References Non-Existent Gate
If an entry point lists a check or review name that doesn't exist (inline in `config.yml` or in `.validator/checks/`/`.validator/reviews/`), validation fails.

### Review Gate Uses Tool Not in `default_preference`
Review gates can specify `cli_preference` but the tools must also appear in `default_preference`.

## `log_dir` Issues

The `log_dir` field (default: `validator_logs`) determines where all logs are written.

**Can't find logs:**
1. Check `config.yml` for the `log_dir` value
2. Verify the directory exists (it's created automatically on first run)
3. Check if a previous `agent-validate clean` archived everything to `previous/`

**Permissions:**
- The gauntlet needs write access to `log_dir`
- On some setups, the directory may not be writable

## `base_branch` Misconfiguration

The `base_branch` (default: `origin/main`) is used for diff calculation. Wrong values cause:
- `no_changes` when there are actually changes (wrong base)
- Diff includes too many files (base too far back)

**Verify:**
```bash
git log --oneline origin/main..HEAD  # Should show your commits
```

If using a different default branch:
```yaml
base_branch: origin/develop
```

## Config Precedence

Most settings come from the project config (`.validator/config.yml`) with built-in defaults as fallback. The global config (`~/.config/agent-validator/config.yml`) only applies to `debug_log` settings:

1. **Project config** (`.validator/config.yml`) — all project settings
2. **Global config** (`~/.config/agent-validator/config.yml`) — `debug_log` only
3. **Defaults** (built-in)

## Init Setup Problems

### "`.gauntlet` directory already exists"
`agent-validate init` won't overwrite an existing `.validator/` directory. Delete it first or manually edit.

### Git Not Initialized
Some features require a git repository. Run `git init` first.

### No Remote Configured
The `base_branch` (e.g., `origin/main`) requires a remote. Run `git remote add origin <url>`.

## Adapter Configuration

Per-adapter settings are configured under `cli.adapters`:
```yaml
cli:
  default_preference:
    - claude
  adapters:
    claude:
      allow_tool_use: true
      thinking_budget: medium  # off, low, medium, high
```

**`thinking_budget` mapping:**
- Claude: off=0, low=8000, medium=16000, high=31999 tokens
- Codex: off=minimal, low=low, medium=medium, high=high
- Gemini: off=0, low=4096, medium=8192, high=24576 tokens

## Debug Logging

Enable detailed logging in config:
```yaml
debug_log:
  enabled: true
  max_size_mb: 10
```

This creates `<log_dir>/.debug.log` with timestamped events.
