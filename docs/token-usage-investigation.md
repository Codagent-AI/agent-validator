# Token Usage Investigation: Gemini vs Claude vs Codex

**Date:** 2026-02-05 (updated 2026-02-06)
**Context:** Investigating why Gemini token usage was significantly higher than expected during Gauntlet code reviews, and comparing against Claude and Codex token usage once instrumentation was added to all three adapters.

## Background

During routine Gauntlet runs, Gemini consumed ~275k total tokens for a single code review. Previous runs on smaller diffs used ~37k tokens. This prompted an investigation into what drives token consumption and whether it could be optimized.

The key question: **Is the high token count due to large diffs, or is the model reading many additional files via tool calls?**

## Instrumentation Added

To answer this, two categories of logging were added.

### 1. Diff and Prompt Size Logging (`src/gates/review.ts`)

After the diff is generated and before the adapter is called, two log lines are emitted:

```
[diff-stats] files=3 lines=530 chars=16161 est_tokens=4041
[input-stats] prompt_chars=2500 diff_chars=16161 total_chars=18661 prompt_est_tokens=625 diff_est_tokens=4041 total_est_tokens=4666
```

- `[diff-stats]` — Size of the delta diff (only the changes since the last successful run, not the full diff from `origin/main`).
- `[input-stats]` — Combined size of the review prompt template + diff, which is what gets piped to the CLI tool as initial input.
- Token estimates use a rough heuristic of ~4 characters per token.

These go to the adapter log files (`.log`) and the debug logger.

### 2. Gemini Telemetry Parsing (`src/cli-adapters/gemini.ts`)

Gemini CLI writes OpenTelemetry data to a `.log` file. The adapter now parses both **metric objects** (for token counts) and **log objects** (for tool call details):

```
[telemetry] in=148898 out=4396 thought=10398 cache=0 tool=0 tool_calls=6 tool_content_chars=71037 api_requests=8
```

| Field | Source | Meaning |
|-------|--------|---------|
| `in` | OTel metric `gen_ai.client.token.usage` (input) | Total input tokens consumed |
| `out` | OTel metric `gen_ai.client.token.usage` (output) | Output tokens generated |
| `thought` | OTel metric (thinking) | Extended thinking tokens |
| `cache` | OTel metric (cache) | Tokens served from cache |
| `tool` | OTel metric (tool) | Tokens attributed to tools |
| `tool_calls` | OTel metric `gen_ai.client.operation.duration` count | Number of tool invocations |
| `tool_content_chars` | OTel log records, `content_length` attribute | Total characters read by tool calls |
| `api_requests` | OTel metric `gen_ai.client.operation.duration` count | API round-trips to the model |

### 3. Claude Telemetry Parsing (`src/cli-adapters/claude.ts`)

Claude Code's OTel console exporter was enabled for both metrics and logs by setting `OTEL_LOGS_EXPORTER=console`. The adapter now parses the `util.inspect()`-formatted OTel event records from stdout:

```
[otel] cost=$0.4540 in=6 out=1679 cacheRead=296659 cacheWrite=42180 tool_calls=6 tool_content_bytes=71037 api_requests=5
```

| Field | Source | Meaning |
|-------|--------|---------|
| `cost` | `api_request` event `cost_usd` attribute (summed) | Total cost in USD |
| `in` | `api_request` event `input_tokens` attribute (summed) | Raw (non-cached) input tokens |
| `out` | `api_request` event `output_tokens` attribute (summed) | Output tokens generated |
| `cacheRead` | `api_request` event `cache_read_tokens` attribute (summed) | Tokens served from cache |
| `cacheWrite` | `api_request` event `cache_creation_tokens` attribute (summed) | Tokens written to cache |
| `tool_calls` | Count of `claude_code.tool_result` events | Number of tool invocations |
| `tool_content_bytes` | `tool_result` event `tool_result_size_bytes` attribute (summed) | Total bytes read by tool calls |
| `api_requests` | Count of `claude_code.api_request` events | API round-trips to the model |

### 4. Codex Telemetry Parsing (`src/cli-adapters/codex.ts`)

Codex CLI supports `--json` which outputs structured JSONL events to stdout. The adapter now uses this to capture per-turn token usage and tool call counts:

```
[codex-telemetry] in=13939 cache=1664 out=1429 api_requests=1
```

| Field | Source | Meaning |
|-------|--------|---------|
| `in` | `turn.completed` event `usage.input_tokens` (summed) | Total input tokens consumed |
| `cache` | `turn.completed` event `usage.cached_input_tokens` (summed) | Tokens served from cache |
| `out` | `turn.completed` event `usage.output_tokens` (summed) | Output tokens generated |
| `tool_calls` | Count of `item.completed` events where type is `command_execution`, `file_change`, or `mcp_tool_call` | Number of tool invocations |
| `api_requests` | Count of `turn.completed` events | API round-trips (turns) to the model |

The adapter parses the JSONL stream, extracts the last `agent_message` item as the review text, and falls back to raw output if no agent message is found.

## Data: Gemini Token Usage Across 4 Successive Runs

These 4 runs happened in succession on the same branch. Each run only reviews the **delta** since the previous successful run (via the `.execution_state` snapshot), not the full diff from `origin/main`.

| Run | Diff Size | Input Tokens | Tool Calls | API Requests | Duration |
|-----|-----------|-------------|------------|-------------|----------|
| 1 (full, from `origin/main`) | 2 files / +109 / -23 | 306,812 | 13 | 16 | 56.3s |
| 2 (delta) | 1 file / +41 / -26 | 184,794 | 5 | 13 | 69.8s |
| 3 (delta) | 2 files / +17 / -6 | 122,502 | 3 | 9 | 45.3s |
| 4 (delta) | 1 file / +5 / -10 | 35,100 | 0 | 3 | 17.4s |

### Key Observations

1. **Token usage correlates strongly with tool calls, not diff size.** Run 1's diff was ~132 lines, which at ~4 chars/token is roughly 2,000–3,000 tokens. Yet Gemini consumed 306,812 input tokens — roughly **100x** the diff. The difference is entirely from Gemini using its tools to read additional files.

2. **Each tool call inflates context massively.** Tool calls invoke `read_file`, `list_directory`, `glob`, or `search_file_content`. Each tool result gets appended to the conversation context, and the full context is re-sent on the next API request. 13 tool calls across 16 API requests compounds the context size.

3. **Zero tool calls = minimal overhead.** Run 4 had 0 tool calls and only 35,100 input tokens for a 15-line diff. The ~35k overhead comes from the Gemini CLI's system prompt, tool definitions, and sandbox setup that are always present.

4. **The review prompt itself is small.** The `[input-stats]` logging showed the prompt + diff was approximately 4,600 tokens for Run 1. Everything above that (~302k tokens) was from Gemini's autonomous file reading.

## Data: Claude vs Gemini Head-to-Head

These two runs used the **same diff** (5 files, +225 / -31 lines, full diff from `origin/main` after a `clean`).

### Run A — First comparison (17.9s Claude / 57.3s Gemini)

| Metric | Claude | Gemini |
|--------|--------|--------|
| Input tokens (raw) | 3 | 148,898 |
| Output tokens | 262 | 1,862 |
| Thinking tokens | — | 6,767 |
| Cache read tokens | 44,878 | 7,523 |
| Cache write tokens | 71,099 | — |
| Tool calls | 3 | 6 |
| Tool content | 66,595 bytes | — |
| API requests | 2 | 8 |
| Cost | $0.47 | — |
| Duration | 17.9s | 57.3s |
| Result | pass (0 violations) | pass (0 violations) |

### Run B — Second comparison (51.2s Claude / 73.7s Gemini)

| Metric | Claude | Gemini |
|--------|--------|--------|
| Input tokens (raw) | 6 | 308,778 |
| Output tokens | 1,679 | 4,180 |
| Thinking tokens | — | 16,168 |
| Cache read tokens | 296,659 | 10,257 |
| Cache write tokens | 42,180 | — |
| Tool calls | 6 | 15 |
| Tool content | 71,037 bytes | — |
| API requests | 5 | 13 |
| Cost | $0.45 | — |
| Duration | 51.2s | 73.7s |
| Result | fail (1 violation) | fail (2 violations) |

### Key Differences

1. **Claude's prompt caching is dramatically more effective.** In Run B, Claude reported only 6 raw input tokens with 296,659 cache-read tokens — the entire prompt was served from cache. Gemini reported 308,778 input tokens with only 10,257 cached. This has major cost implications: Claude charges significantly less for cached tokens.

2. **Claude makes fewer tool calls.** 3–6 tool calls for Claude vs 6–15 for Gemini. Gemini is more aggressive about reading external files beyond the diff. Each tool call inflates the context for subsequent API requests.

3. **Claude makes fewer API round-trips.** 2–5 for Claude vs 8–13 for Gemini. This directly impacts latency — Claude completes reviews faster (17.9s vs 57.3s in Run A).

4. **Claude provides explicit cost tracking.** Each review costs ~$0.45–0.47. Gemini's telemetry doesn't include cost data, though the token counts suggest it may be comparable or higher depending on the model's pricing per million tokens.

5. **Claude's output is more concise.** 262–1,679 output tokens vs 1,862–4,180 for Gemini.

## Data: Claude vs Codex Head-to-Head

These runs used the same diff (7 files, +225 lines changed from `origin/main`) with Claude as reviewer #1 and Codex as reviewer #2.

### Run A — First head-to-head (125.4s Claude / 27.0s Codex)

| Metric | Claude | Codex |
|--------|--------|-------|
| Input tokens (raw) | 21 | 13,961 |
| Output tokens | 5,121 | 1,198 |
| Cache read tokens | 572,789 | 1,664 |
| Cache write tokens | 85,890 | — |
| Tool calls | 15 | 0 |
| Tool content | 97,468 bytes | — |
| API requests | 12 | 1 |
| Cost | $0.95 | — |
| Duration | 125.4s | 27.0s |

### Run B — Second head-to-head (118.4s Claude / 24.5s Codex)

| Metric | Claude | Codex |
|--------|--------|-------|
| Input tokens (raw) | 24 | 13,939 |
| Output tokens | 4,382 | 1,429 |
| Cache read tokens | 549,128 | 1,664 |
| Cache write tokens | 64,190 | — |
| Tool calls | 13 | 0 |
| Tool content | 108,626 bytes | — |
| API requests | 11 | 1 |
| Cost | $0.79 | — |
| Duration | 118.4s | 24.5s |
| Result | fail (3 violations) | fail (1 violation) |

### Key Differences

1. **Codex is 5x faster.** A single API turn (24–27s) vs 11–12 turns (118–125s). Codex doesn't use tools, so there's no multi-turn overhead.

2. **Codex uses dramatically fewer tokens.** ~14k total input tokens vs ~550–650k effective context for Claude (cache read + write). Even though Claude's raw input is near zero (cached), the model still processes the full cached context.

3. **Claude is more thorough.** Claude found 3 violations in Run B vs 1 for Codex. Claude's 13–15 tool calls read 97–108KB of surrounding source code, giving it deeper context to identify issues that aren't visible from the diff alone.

4. **Codex has zero tool call overhead.** In `exec --sandbox read-only` mode with `--json`, Codex relies entirely on the prompt + diff. It doesn't read additional files. This is the primary reason for its speed and token efficiency, but also limits its ability to catch issues requiring broader context.

5. **Cost vs quality trade-off is clear.** Claude at $0.79–0.95 per review catches more issues. Codex appears to be significantly cheaper (no explicit cost tracking yet, but ~14k input tokens at typical API pricing would be well under $0.10). For `num_reviews: 2`, using both provides a good balance — Codex catches obvious issues quickly, Claude provides deeper analysis.

## Why Does Gemini Use So Many More Tokens?

The review prompt (in `.gauntlet/reviews/code-quality.md`) includes this instruction:

> If the diff is insufficient or ambiguous, use your tools to read the full file content or related files for context.

This is intentional — reviewers need file context to assess changes properly. But Gemini interprets this much more aggressively than Claude:

- **Gemini** reads 6–15 files per review, consuming 100k–300k+ input tokens via tool calls
- **Claude** reads 3–6 files, consuming ~66k bytes of tool content, but leverages caching so heavily that the effective input token cost is near zero

The difference is compounded because Gemini sends the **full accumulated context** (prompt + diff + all previous tool results) with each subsequent API request. With 13–16 API requests and growing context, this creates a multiplicative effect on token usage.

## Baseline Overhead

When no tool calls are made (Gemini Run 4), the baseline overhead is approximately:

| Component | Estimated Tokens |
|-----------|-----------------|
| Gemini system prompt + sandbox | ~20,000–25,000 |
| Tool definitions (read_file, list_directory, glob, search_file_content) | ~5,000 |
| Review prompt template | ~625 |
| Diff content | varies |
| **Total baseline** | **~30,000 + diff** |

Claude's baseline is harder to measure since it always shows near-zero raw input tokens (everything gets cached), but the `cacheWrite` of ~71k on first invocation suggests a similar system prompt overhead.

## Recommendations

1. **Consider Codex for cost-sensitive reviews.** Codex completes reviews in a single API turn with ~14k input tokens and zero tool calls. For reviews where the diff provides sufficient context, it's 20–100x cheaper than Gemini or Claude.

2. **Consider limiting Gemini's tool budget.** Gemini has `--allowed-tools` configured but no mechanism to limit the *number* of tool calls. The `--max-turns` flag limits API round-trips but not tool invocations per turn. Reducing the prompt's encouragement to read files, or specifying "only read files directly referenced in the diff," could reduce tool call frequency.

3. **Add a token budget flag.** Gemini CLI supports `--thinking-budget` which controls how many thinking tokens are used. This could help reduce the thinking token overhead (6k–22k per run).

4. **Monitor tool_calls as the primary cost driver.** The correlation between tool calls and total token usage is the strongest signal. Diff size matters much less — a 15-line diff with 13 tool calls costs far more than a 130-line diff with 0.

5. **Leverage Claude's caching advantage.** Claude's prompt caching is extremely effective for repeated reviews on the same codebase. If running multiple reviews in succession (e.g., `num_reviews: 2`), Claude's second review will benefit from cached context, while Gemini re-sends everything.

6. **Use multi-adapter reviews for quality vs cost trade-off.** Running `num_reviews: 2` with a fast/cheap adapter (Codex) and a thorough adapter (Claude) gives both breadth and depth. Codex catches obvious issues cheaply; Claude reads surrounding files for deeper analysis.

7. **Persist telemetry to debug log.** Currently, the `[telemetry]`, `[otel]`, and `[codex-telemetry]` summary lines go to the adapter `.log` files and stdout, but those log files get cleaned on pass. Persisting these summaries to the `.debug.log` would enable longitudinal analysis without requiring manual log capture. This is the highest-priority improvement for continued monitoring.

## Technical Implementation Notes

### Gemini Telemetry

The Gemini CLI writes OTel data to `~/.gemini/logs/telemetry/*.log` files as NDJSON. The adapter:
1. Reads these files after the CLI process exits
2. Parses both `scopeMetrics` (for token counters) and `scopeLogs` (for tool call content lengths)
3. Cleans up the telemetry files
4. Emits a `[telemetry]` summary line

### Claude Telemetry

Claude Code uses the Node.js OTel SDK `ConsoleLogRecordExporter` and `ConsoleMetricExporter`, both writing to stdout. The output is in `util.inspect()` format (unquoted keys, single-quoted strings), not JSON. The adapter:
1. Enables `OTEL_LOGS_EXPORTER=console` alongside the existing `OTEL_METRICS_EXPORTER=console`
2. Buffers all stdout+stderr output
3. Matches OTel log blocks with a regex: `/\{\s*\n\s*resource:\s*\{[\s\S]*?body:\s*'claude_code\.\w+'[\s\S]*?\n\}/g`
4. Extracts `tool_result_size_bytes` from `claude_code.tool_result` events
5. Extracts `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, and `cost_usd` from `claude_code.api_request` events
6. Strips all OTel blocks from the output before passing it to the review parser
7. Emits an `[otel]` summary line

### Codex Telemetry

Codex CLI supports `--json` mode which streams structured JSONL events to stdout. The adapter:
1. Adds `--json` to the `codex exec` arguments
2. Buffers all stdout (which is now JSONL instead of plain text)
3. Parses each line as JSON, looking for `turn.completed` events (token usage) and `item.completed` events (tool calls, agent messages)
4. Sums `input_tokens`, `cached_input_tokens`, and `output_tokens` across all turns
5. Counts `command_execution`, `file_change`, and `mcp_tool_call` items as tool calls
6. Extracts the last `agent_message` item's text as the review output
7. Falls back to raw output if no agent message is found (error handling)
8. Emits a `[codex-telemetry]` summary line

Unlike Claude and Gemini which require parsing non-standard OTel formats, Codex's JSONL output is clean, structured JSON — making it the most reliable to parse.

### Regex Note

The initial `OTEL_LOG_BLOCK_RE` regex failed to match the actual Claude output format. The Node.js OTel SDK `ConsoleLogRecordExporter` uses `console.log(record)`, which calls `util.inspect()` and produces output like:

```
{
  resource: {
    attributes: {
      'host.arch': 'arm64',
      'service.name': 'claude-code',
      ...
    }
  },
  instrumentationScope: { ... },
  timestamp: 1770343357433000,
  body: 'claude_code.tool_result',
  attributes: {
    'event.name': 'tool_result',
    tool_name: 'Read',
    tool_result_size_bytes: '8521',
    ...
  }
}
```

This is **not JSON** — keys are unquoted, strings use single quotes, and `undefined` appears as a literal. The working regex anchors on `resource:` at the start and `body: 'claude_code.\w+'` as the unique identifier.
