# CLI Invocation Details

This document details how Agent Validator invokes supported AI CLI tools to ensure:
- **Non-interactive execution** (no hanging on prompts)
- **Read-only access** (no file modifications)
- **Repo-scoped visibility** (limited to the project root)

All adapters write the prompt (including diff) to a temporary file and pipe it to the CLI.

## Common Behavior

- **Dynamic Context**: Agents are invoked in a non-interactive, read-only mode where they can use their own file-reading and search tools to pull additional context from your repository as needed.
- **Security**: By using standard CLI tools with strict flags (like `--sandbox` or `--allowed-tools`), Agent Validator ensures that agents can read your code to review it without being able to modify your files or escape the repository scope.
- **Output Parsing**: All agents are instructed to output strict JSON. The `ReviewGateExecutor` parses this JSON to determine pass/fail status.

---

## Gemini

**Adapter**: `src/cli-adapters/gemini.ts`

```bash
cat "<tmpFile>" | gemini \
  --sandbox \
  --allowed-tools read_file list_directory glob search_file_content \
  --output-format text
```

### Flags Explanation
- **`--sandbox`**: Enables the execution sandbox for safety.
- **`--allowed-tools ...`**: Explicitly whitelists read-only tools. Any attempt to use other tools (like `write_file`) will fail or prompt (which fails in non-interactive mode), ensuring read-only safety.
- **`--output-format text`**: Ensures the output is plain text suitable for parsing.
- **Repo Scoping**: Implicitly scoped to the Current Working Directory (CWD) because no `--include-directories` are provided.

---

## Codex

**Adapter**: `src/cli-adapters/codex.ts`

```bash
cat "<tmpFile>" | codex exec \
  --cd "<repoRoot>" \
  --sandbox read-only \
  -c 'ask_for_approval="never"' \
  -
```

### Flags Explanation
- **`exec`**: Subcommand for non-interactive execution.
- **`--cd "<repoRoot>"`**: Sets the working directory to the repository root.
- **`--sandbox read-only`**: Enforces a strict read-only sandbox policy for any shell commands the agent generates.
- **`-c 'ask_for_approval="never"'`**: Config override to prevent the CLI from asking for user confirmation before running commands. This is critical for preventing hangs in CI/automated environments.
- **`-`**: Tells Codex to read the prompt from stdin.

---

## Claude Code

**Adapter**: `src/cli-adapters/claude.ts`

```bash
cat "<tmpFile>" | claude -p \
  --cwd "<repoRoot>" \
  --allowedTools "Read,Glob,Grep" \
  --max-turns 10
```

### Flags Explanation
- **`-p` (or `--print`)**: Runs Claude in non-interactive print mode. Output is printed to stdout.
- **`--cwd "<repoRoot>"`**: Sets the working directory to the repository root.
- **`--allowedTools "Read,Glob,Grep"`**: Restricts the agent to a specific set of read-only tools.
  - `Read`: Read file contents.
  - `Glob`: List files matching a pattern.
  - `Grep`: Search file contents.
- **`--max-turns 10`**: Limits the number of agentic turns (tool use loops) to prevent infinite loops or excessive costs.

---

## GitHub Copilot CLI

**Adapter**: `src/cli-adapters/github-copilot.ts`

```bash
cat "<tmpFile>" | copilot -s \
  --allow-tool 'shell(cat)' --allow-tool 'shell(grep)' \
  --allow-tool 'shell(ls)' --allow-tool 'shell(find)' \
  --allow-tool 'shell(head)' --allow-tool 'shell(tail)' \
  --model "<model>" --effort <level>
```

### Flags Explanation
- **`copilot`**: Invokes the standalone Copilot CLI directly.
- **`-s` (silent)**: Suppresses UI output and stats, returning only the agent response for clean output parsing.
- **`--allow-tool 'shell(cat)' ...`**: Explicitly whitelists read-only shell tools. Tool names must use the `shell(command)` format. Any attempt to use other tools will fail, ensuring read-only safety. When `allow_tool_use` is `false` in the adapter config, no `--allow-tool` flags are passed.
- **`--model "<model>"`**: Passes the configured model name directly (free-form, no resolution). If omitted, Copilot uses its default model. Invalid model names produce a clear error.
- **`--effort <level>`**: Maps from the `thinking_budget` adapter config (`low`→`low`, `medium`→`medium`, `high`→`high`). Omitted when `thinking_budget` is `off`.
- **Repo Scoping**: Implicitly scoped to the Current Working Directory (CWD) where the command is executed (repository root).
- **Availability**: Checked via `copilot --help` with a 10-second timeout.

### Plugin Support
- **Detection**: Reads `~/.copilot/config.json` to check the `installed_plugins` array
- **Installation**: `copilot plugin install Codagent-AI/agent-validator`
- **Skill directories**: `.github/skills/` (project), `~/.copilot/skills/` (user)
- **Hooks**: Supported via the Copilot CLI plugin system

---

## Cursor

**Adapter**: `src/cli-adapters/cursor.ts`

```bash
cat "<tmpFile>" | agent
```

### Flags Explanation
- **No flags**: The `agent` command reads the prompt from stdin and processes it using Cursor's AI capabilities.
- **Repo Scoping**: Implicitly scoped to the Current Working Directory (CWD) where the command is executed (repository root).
- **Model**: Uses the default model configured by the user in Cursor.

### Notes
- Cursor does not support custom commands
- The `agent` command is the CLI interface provided by Cursor for AI-assisted development

---

## Adapter Health and Cooldown

Review gates dispatch work to CLI adapters via round-robin. If an adapter hits a usage limit or quota error during a review, it is marked **unhealthy** for a 1-hour cooldown period. This prevents wasting time retrying adapters that are temporarily unavailable.

### How It Works

1. **Detection**: When an adapter process exits with an error, the system checks the error output for usage-limit phrases (e.g., "usage limit", "quota exceeded", "credit balance is too low").
2. **Marking**: If a usage limit is detected, the adapter is written to the `unhealthy_adapters` map in `validator_logs/.execution_state` with a `marked_at` timestamp and `reason`.
3. **Skipping**: On each subsequent run, before dispatching reviews, the system checks the unhealthy map. Adapters within the 1-hour cooldown are skipped.
4. **Recovery**: After the cooldown expires, the adapter's binary is probed via `checkHealth()`. If healthy, the flag is cleared and the adapter rejoins the pool.
5. **Round-robin fallback**: The `num_reviews` round-robin assignment uses only healthy adapters. If `num_reviews: 2` but only one adapter is healthy, both review slots are assigned to that adapter.
6. **No mid-execution failover**: If an adapter fails during a run, that review slot is lost for the current iteration. The adapter is marked unhealthy and skipped on the next rerun.
7. **No healthy adapters**: If all configured adapters are unhealthy or unavailable, the review gate returns an error immediately.

### Example

With `cli_preference: [codex, gemini]` and `num_reviews: 2`, if codex hits a rate limit:
- **Current run**: codex@1 errors, gemini@2 passes → gate fails (incomplete reviews)
- **Next run**: codex is cooling down and skipped → gemini@1 and gemini@2 both assigned → gate can pass

### Usage Limit Detection

The `isUsageLimit()` function checks error output for these phrases (case-insensitive):
- "usage limit"
- "quota exceeded"
- "quota will reset"
- "credit balance is too low"
- "out of extra usage"
- "out of usage"

Detection happens at two points:
1. When review output fails to parse as valid JSON (the output itself contains the limit message)
2. When the adapter process exits with a non-zero code (the stderr is included in the error message)