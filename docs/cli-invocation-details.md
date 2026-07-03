---
title: CLI Invocation Details
group: Reference
order: 3
description: Exact adapter subprocess invocation behavior.
---

# CLI Invocation Details

Review adapters run local AI CLIs as subprocesses. Agent Validator prepares a prompt plus diff, writes it to a temporary file when needed, invokes the adapter command, and parses strict JSON from the response.

## Common Behavior

- Adapter commands run from the repository root.
- Model IDs are passed only when they match the adapter's safe model-id pattern.
- `allow_tool_use: false` disables tools only when the underlying CLI exposes a reliable flag for that behavior.
- Usage-limit output marks an adapter unhealthy for cooldown and recovery.

## Gemini

Adapter: `src/cli-adapters/gemini.ts`

```bash
gemini --sandbox --allowed-tools read_file,list_directory,glob,search_file_content --output-format text < "$PROMPT_FILE"
```

When `allow_tool_use: false`, the `--allowed-tools` argument is omitted.

## Codex

Adapter: `src/cli-adapters/codex.ts`

```bash
codex exec --cd "$REPO_ROOT" --sandbox read-only -c 'ask_for_approval="never"' --json -
```

Additional behavior:

- `allow_tool_use: false` adds `--disable shell_tool --ignore-user-config`.
- `thinking_budget` maps to `-c model_reasoning_effort="..."`.
- `model` maps to `-m <model>`.
- The prompt is read from stdin with `-`.

## Claude Code

Adapter: `src/cli-adapters/claude.ts`

```bash
cat "$PROMPT_FILE" | claude -p --allowedTools Read,Glob,Grep,Task --max-turns 25
```

Additional behavior:

- `allow_tool_use: false` uses `--allowedTools Task`.
- `Task` is always allowed so Claude can dispatch review subagents when configured.
- `model` maps to `--model <model>`.
- OpenTelemetry environment variables are set so token and request metrics can be extracted from CLI output.

## GitHub Copilot

Adapter: `src/cli-adapters/github-copilot.ts`

```bash
copilot --allow-tool shell(cat) --add-dir "$PROMPT_DIR" --prompt "$PROMPT_FILE_INSTRUCTION"
```

Additional behavior:

- `shell(cat)` is always allowed because Copilot uses prompt-file handoff instead of stdin.
- When `allow_tool_use` is not `false`, read-only tools are added: `shell(grep)`, `shell(ls)`, `shell(find)`, `shell(head)`, and `shell(tail)`.
- `model` maps to `--model <model>`.
- `thinking_budget` maps to `--effort <level>`.
- Availability is checked with `copilot --help`.
- Plugin install instructions use `copilot plugin install Codagent-AI/agent-validator`.

## Cursor

Adapter: `src/cli-adapters/cursor.ts`

```bash
cat "$PROMPT_FILE" | agent --trust
```

Additional behavior:

- The prompt is piped on stdin.
- `model` resolves through Cursor model discovery when possible and maps to `--model <model>`.
- Cursor's CLI currently does not expose adapter flags for read-only sandboxing or tool denial, so `allow_tool_use` cannot enforce those restrictions.

## OpenCode

Adapter: `src/cli-adapters/opencode.ts`

```bash
cat "$PROMPT_FILE" | opencode run --format json
```

Additional behavior:

- `model` maps to `--model <model>`.
- `thinking_budget` maps to an OpenCode `--variant` when configured.
- `allow_tool_use: false` emits a warning because OpenCode does not expose a tool-disable flag.
- The adapter parses JSONL output and extracts review text from the stream.

## Adapter Health And Cooldown

If an adapter hits a usage limit or quota error during a review, Agent Validator records it as unhealthy and skips it during cooldown.

The usage-limit detector checks for phrases such as:

- `usage limit`
- `quota exceeded`
- `quota will reset`
- `credit balance is too low`
- `out of extra usage`
- `out of usage`

Cooldown state is stored with execution state and checked before review dispatch. After cooldown expires, Agent Validator probes adapter health and returns the adapter to the pool when it is available again.
