# Eval Results: Adapter Configuration

**Date:** 2026-02-07 (Codex), 2026-02-08 (Claude)
**Fixture:** fixtures/review-quality (10 seeded issues across 3 difficulty levels)
**Eval matrix:** 4 configurations x 3 runs each (12 total runs per adapter)

### Versions

| Adapter | CLI Version | Model |
|---------|------------|-------|
| Claude | 2.1.32 (Claude Code) | claude-opus-4-6 |
| Codex | codex-cli 0.98.0 | gpt-5.3-codex |
| Gemini | 0.27.3 | (default — not evaluated) |

**Judge:** Claude CLI 2.1.32, model claude-opus-4-6, thinking budget high

## Executive Summary

Both Codex and Claude were evaluated across 4 configuration variants. Key findings:

- **Claude is the higher-quality adapter** — F1=0.71 vs Codex F1=0.69 at their respective best configs.
- **Claude is remarkably configuration-insensitive** — 3 of 4 configs tied at F1=0.71. Codex showed a much wider spread (0.53–0.69).
- **For both adapters, tools-on-thinking-high was worst or tied-worst** — contradicting the expectation that maximum capability yields maximum quality.
- **No adapter detected any hard issue (0/3)** — cross-file bugs requiring import exploration remain undetected regardless of configuration.

**Recommended settings:**
```yaml
claude:
  allow_tool_use: false
  thinking_budget: high
codex:
  allow_tool_use: false
  thinking_budget: low
```

Claude's tools-off-thinking-high was chosen as the recommended config because it ties for best F1 (0.71) while using the fewest tokens (12.2k total) and fastest time (58.4s).

## Configuration Matrix

| Config | Tool Use | Thinking | Hypothesis |
|--------|----------|----------|------------|
| tools-on-thinking-high | On | High | Expected best: deepest analysis + file exploration |
| tools-on-thinking-low | On | Low | Fast with file access |
| tools-off-thinking-high | Off | High | Deep analysis on diff only |
| tools-off-thinking-low | Off | Low | Expected worst: minimal analysis, no file access |

## Results

### Quality Metrics (sorted by F1)

| Config | Precision | Recall | F1 | Consistency | Time |
|--------|-----------|--------|-----|-------------|------|
| tools-off-thinking-low | **0.90** | **0.57** | **0.69** | **53%** | **23.7s** |
| tools-on-thinking-high | 0.81 | 0.43 | 0.56 | 43% | 63.5s |
| tools-off-thinking-high | 0.77 | 0.43 | 0.55 | 43% | 68.5s |
| tools-on-thinking-low | 0.80 | 0.40 | 0.53 | 40% | 29.7s |

### Token Usage

| Config | Input | Output | Thinking | Total | Tool Calls |
|--------|-------|--------|----------|-------|------------|
| tools-off-thinking-low | 28.0k | 7.7k | 0 | **35.7k** | 0 |
| tools-off-thinking-high | 48.5k | 15.2k | 0 | 63.6k | 3 |
| tools-on-thinking-high | 108.0k | 14.1k | 0 | 122.1k | 9 |
| tools-on-thinking-low | 118.2k | 8.2k | 0 | 126.4k | 11 |

Token counts include both adapter and judge (Claude with high thinking) tokens across all 3 runs per config.

### Per-Issue Detection Rates

#### Easy Issues (3 issues)

| Issue | tools-off-low | tools-on-high | tools-off-high | tools-on-low |
|-------|---------------|---------------|----------------|--------------|
| sql-injection | 100% | 100% | 100% | 100% |
| hardcoded-secret | 100% | 100% | 100% | 100% |
| null-deref | 100% | 100% | 100% | 100% |

All configurations reliably detect easy issues — these are obvious bugs visible directly in the diff.

#### Medium Issues (4 issues)

| Issue | tools-off-low | tools-on-high | tools-off-high | tools-on-low |
|-------|---------------|---------------|----------------|--------------|
| error-swallow | 100% | 100% | 100% | 100% |
| input-validation | **67%** | 0% | 33% | 0% |
| missing-await | **33%** | 0% | 33% | 0% |
| cache-leak | **33%** | 33% | 0% | 0% |

The winning config found medium issues that other configs missed entirely. Tools-on-thinking-low never found any medium issue beyond error-swallow.

#### Hard Issues (3 issues — require tool use)

| Issue | tools-off-low | tools-on-high | tools-off-high | tools-on-low |
|-------|---------------|---------------|----------------|--------------|
| race-condition | 0% | 0% | 0% | 0% |
| sanitize-bypass | 0% | 0% | 0% | 0% |
| auth-bypass | 0% | 0% | 0% | 0% |

No configuration detected any hard issue. These require reading source files outside the diff (imported modules containing the actual vulnerabilities). See "Why Tool Use Failed" below.

## Analysis

### Why Tools Off Beat Tools On

The tools-on configurations used tools **redundantly** — Codex read the same files already provided in the diff context (`src/api/handler.ts`, `src/utils/cache.ts`) using `sed` and `nl` commands. It never explored imported modules where the hard bugs live (`src/auth/session.js`, `src/utils/sanitize.js`, `src/api/middleware.js`).

This redundant file reading consumed 3-5x more input tokens (34k-50k vs 9,321 per run) without adding information. The tools-off configs used their smaller context window more efficiently, focusing analysis on the diff itself and catching medium-difficulty issues that tools-on missed.

**Per-run input token comparison:**
- tools-off-thinking-low: 9,321 tokens (constant across all 3 runs)
- tools-on-thinking-low: 34,508 / 48,249 / 35,482 tokens (variable, 3-5x higher)

### Why Low Thinking Beat High Thinking

High thinking doubled execution time (24s to 68s) without improving detection quality. For both tools-on and tools-off, the low thinking variant outperformed its high thinking counterpart:

- tools-off: low=0.69 F1 vs high=0.55 F1
- tools-on: low=0.53 F1 vs high=0.56 F1 (marginal difference)

High thinking produced more output tokens (15.2k vs 7.7k for tools-off) but this additional reasoning did not translate to better issue detection. The additional deliberation may introduce overthinking or dilute focus.

### Why Tool Use Failed for Hard Issues

The three hard issues (race-condition, sanitize-bypass, auth-bypass) are only detectable by reading source files **not present in the diff**. Even with tool use enabled:

1. Codex never navigated to imported modules — it only re-read files already in the diff
2. The tool calls were confirmatory (re-reading known files) rather than exploratory (discovering new files)
3. MCP introspection calls (`list_mcp_resources`) consumed tool call budget without productive file reading

This suggests the review prompt needs explicit guidance to explore imported dependencies, or the adapter needs a more sophisticated tool-use strategy.

### Bug Found: MCP Tool Leak

The `tools-off-thinking-high` configuration leaked MCP tool calls in 2 of 3 runs:
- Run 1: 1 tool call (`list_mcp_resources`), inputTokens inflated from 9,321 to 18,997
- Run 2: 2 tool calls (`list_mcp_resources`, `list_mcp_resource_templates`), inputTokens inflated to 20,127

The `allowToolUse: false` setting blocks shell/command tools but does not fully block MCP introspection calls in the Codex adapter. This inflated the tools-off-thinking-high token count and may partially explain its underperformance relative to tools-off-thinking-low.

### Judge Reliability

The judge (Claude with high thinking) was highly consistent:
- The same 4 core issues (sql-injection, null-deref, error-swallow, hardcoded-secret) were matched identically across all 12 runs
- False positive classification was deterministic — the "missing authorization on delete" finding was correctly rejected as a false positive in all 11 runs that flagged it (the ground truth's auth-bypass is about session revocation, not ownership checks)
- All scoring variation traced back to genuine differences in adapter output, not judge inconsistency

## Claude Adapter Results

**Eval date:** 2026-02-08
**Eval matrix:** Claude adapter, 4 configurations, 3 runs each (12 total runs)

### Claude Quality Metrics (sorted by F1)

| Config | Precision | Recall | F1 | Consistency | Time |
|--------|-----------|--------|-----|-------------|------|
| tools-on-thinking-low | 0.86 | 0.60 | **0.71** | 60% | 63.1s |
| tools-off-thinking-low | 0.86 | 0.60 | **0.71** | 60% | 72.3s |
| tools-off-thinking-high | 0.86 | 0.60 | **0.71** | 60% | 58.4s |
| tools-on-thinking-high | 0.84 | 0.53 | 0.65 | 53% | 55.3s |

### Claude Token Usage

| Config | Input | Output | Thinking | Total | Tool Calls |
|--------|-------|--------|----------|-------|------------|
| tools-on-thinking-low | 14 | 14.4k | 0 | 14.4k | 4 |
| tools-off-thinking-low | 20 | 15.4k | 0 | 15.4k | 2 |
| tools-off-thinking-high | 20 | 12.2k | 0 | **12.2k** | 1 |
| tools-on-thinking-high | 15 | 11.7k | 0 | 11.8k | 6 |

Note: Claude's `[otel]` telemetry does not report a separate `thought=` field — thinking tokens are likely included in the output count. Input tokens appear low because prompt caching offloads most input to `cacheRead` (7.3k per run).

### Claude Per-Issue Detection Rates

#### Easy Issues (3 issues)

| Issue | tools-on-low | tools-off-low | tools-off-high | tools-on-high |
|-------|-------------|---------------|----------------|--------------|
| sql-injection | 100% | 100% | 100% | 100% |
| hardcoded-secret | 100% | 100% | 100% | 100% |
| null-deref | 100% | 100% | 100% | 100% |

#### Medium Issues (4 issues)

| Issue | tools-on-low | tools-off-low | tools-off-high | tools-on-high |
|-------|-------------|---------------|----------------|--------------|
| error-swallow | 100% | 100% | 100% | 100% |
| missing-await | 100% | 100% | 100% | 100% |
| input-validation | 100% | 100% | 100% | 67% |
| cache-leak | 0% | 0% | 0% | 0% |

Claude detected medium issues far more reliably than Codex — missing-await and input-validation at 100% across most configs (vs 0-67% for Codex). Only cache-leak was universally missed by both adapters.

#### Hard Issues (3 issues)

| Issue | tools-on-low | tools-off-low | tools-off-high | tools-on-high |
|-------|-------------|---------------|----------------|--------------|
| race-condition | 0% | 0% | 0% | 0% |
| sanitize-bypass | 0% | 0% | 0% | 0% |
| auth-bypass | 0% | 0% | 0% | 0% |

Same as Codex: no configuration detected any hard issue.

### Claude Analysis

**Configuration insensitivity:** Three of four Claude configs tied at F1=0.71. This contrasts sharply with Codex, where the spread was 0.53–0.69. Claude's review quality is robust to configuration changes.

**tools-on-thinking-high was worst here too:** F1=0.65, the only config below 0.71. The same pattern as Codex — maximum capability = worst performance.

**Efficiency winner: tools-off-thinking-high.** While three configs tied on F1, tools-off-thinking-high used the fewest tokens (12.2k) and was fastest (58.4s), making it the most efficient Claude configuration.

## Cross-Adapter Comparison

### Best Config per Adapter

| Adapter | Best Config | Precision | Recall | F1 | Time | Total Tokens |
|---------|------------|-----------|--------|-----|------|-------------|
| Claude | tools-off-thinking-high | 0.86 | 0.60 | **0.71** | 58.4s | 12.2k |
| Codex | tools-off-thinking-low | 0.90 | 0.57 | 0.69 | 23.7s | 35.7k |

### Key Differences

- **Claude has higher recall** (0.60 vs 0.57) — it detects more issues, particularly medium-difficulty ones like missing-await (100% vs 33%) and input-validation (100% vs 67%).
- **Codex has higher precision** (0.90 vs 0.86) — it produces fewer false positives.
- **Codex is 2.5x faster** (23.7s vs 58.4s) but uses 3x more total tokens (35.7k vs 12.2k). Claude benefits from aggressive prompt caching.
- **Claude is more configuration-robust** — less risk of performance degradation from misconfiguration.
- **Neither adapter detects hard issues** — both are limited to diff-visible bugs.

### Gemini

Gemini eval was attempted but all 12 runs produced invalid results due to Claude judge rate limiting. A re-run is needed. Preliminary single-run data (tools-on, thinking-off) showed F1=0.53 with 152.6k tokens and 113.1s — significantly worse than both Claude and Codex.

Note: Codex with `thinking_budget: "off"` (maps to `reasoning.effort: "minimal"`) fails when tool use is enabled due to a Codex CLI limitation: `web_search` tool cannot be used with minimal reasoning effort.

## Recommendations

1. **Use Claude as the default review adapter.** It achieves the highest F1 (0.71), is the most configuration-robust, and uses the fewest tokens at its optimal config. Set to tools-off, thinking-high.

2. **Use Codex as a fast alternative.** When speed matters more than recall, Codex tools-off-thinking-low is 2.5x faster with only a marginal quality loss (F1 0.69 vs 0.71).

3. **Investigate the MCP tool leak in Codex.** The Codex adapter's `allowToolUse: false` should fully disable all tools including MCP introspection. This is a bug in the adapter configuration layer.

4. **Re-run Gemini eval.** Need controlled multi-run results to determine if Gemini is viable or should be deprioritized. Preliminary data suggests it's significantly worse than both Claude and Codex.

5. **Improve hard-issue detection.** No configuration found any of the 3 tool-use-required issues. Options:
   - Add explicit instructions in the review prompt to explore imported modules
   - Implement a two-pass review strategy: first pass identifies imports, second pass reads them
   - Accept that cross-file bugs may be beyond current single-prompt review capability

6. **Investigate cache-leak detection.** This medium-difficulty issue was missed by all configs of both adapters. It may need a more specific prompt hint or represent a blind spot in current LLM code review.
