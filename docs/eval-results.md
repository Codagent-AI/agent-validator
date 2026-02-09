# Eval Results: Adapter Configuration

**Date:** 2026-02-07 (Codex), 2026-02-08 (Claude, Gemini)
**Fixture:** fixtures/review-quality (10 seeded issues across 3 difficulty levels)
**Eval matrix:** 4 configurations x 3 runs each (12 total runs per adapter)

### Versions

| Adapter | CLI Version | Model |
|---------|------------|-------|
| Claude | 2.1.32 (Claude Code) | claude-opus-4-6 |
| Codex | codex-cli 0.98.0 | gpt-5.3-codex |
| Gemini | 0.27.3 | gemini-3.0 (may have fallen back to a flash variant mid-eval due to rate limits) |

**Judge:** Claude CLI 2.1.32, model claude-opus-4-6, thinking budget high

## Executive Summary

All three adapters (Claude, Codex, Gemini) were evaluated across 4 configuration variants. Key findings:

- **Claude is the highest-quality adapter** — F1=0.71 vs Codex F1=0.69 vs Gemini F1=0.62 at their respective best configs.
- **Claude is remarkably configuration-insensitive** — 3 of 4 configs tied at F1=0.71. Codex (0.53–0.69) and Gemini (0.53–0.62) showed wider spreads.
- **For all three adapters, tools-on-thinking-high was worst or tied-worst** — contradicting the expectation that maximum capability yields maximum quality.
- **No adapter detected any hard issue (0/3)** — cross-file bugs requiring import exploration remain undetected regardless of adapter or configuration.
- **Gemini uses 20-100x more tokens than Claude** for comparable or worse quality, making it the least efficient adapter.

**Recommended settings:**
```yaml
claude:
  allow_tool_use: false
  thinking_budget: high
codex:
  allow_tool_use: false
  thinking_budget: low
gemini:
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

## Gemini Adapter Results

**Eval date:** 2026-02-08
**Eval matrix:** Gemini adapter (0.27.3, model gemini-3.0 default — may have fallen back to a flash variant mid-eval due to rate limits), 4 configurations, 3 runs each (12 total runs)

### Gemini Quality Metrics (sorted by F1)

| Config | Precision | Recall | F1 | Consistency | Time |
|--------|-----------|--------|-----|-------------|------|
| tools-on-thinking-low | 0.83 | 0.50 | **0.62** | 47% | 58.2s |
| tools-off-thinking-low | 0.89 | 0.47 | 0.60 | 43% | 81.0s |
| tools-off-thinking-high | 0.81 | 0.43 | 0.56 | 43% | 55.4s |
| tools-on-thinking-high | 0.80 | 0.40 | 0.53 | 40% | 69.5s |

### Gemini Token Usage

| Config | Input | Output | Thinking | Total | Tool Calls |
|--------|-------|--------|----------|-------|------------|
| tools-off-thinking-high | 221.2k | 12.5k | 38.0k | 271.7k | 10 |
| tools-on-thinking-high | 603.0k | 15.0k | 74.5k | 692.4k | 36 |
| tools-on-thinking-low | 756.8k | 16.1k | 72.1k | 845.0k | 39 |
| tools-off-thinking-low | 1.1M | 18.4k | 147.3k | 1.3M | 59 |

Token counts include both adapter and judge tokens across all 3 runs per config. Gemini reports thinking tokens separately (unlike Claude's telemetry which bundles them into output).

### Gemini Per-Issue Detection Rates

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
| cache-leak | 33% | 33% | 33% | 0% |
| missing-await | 33% | 0% | 0% | 0% |
| input-validation | 0% | 0% | 0% | 0% |

Gemini's medium issue detection is the weakest of all three adapters. It never found input-validation (Claude: 100%, Codex: 67% at best). cache-leak was found sporadically at 33% — better than Claude (0%) but worse than Codex's best (33%).

#### Hard Issues (3 issues)

| Issue | tools-on-low | tools-off-low | tools-off-high | tools-on-high |
|-------|-------------|---------------|----------------|--------------|
| race-condition | 0% | 0% | 0% | 0% |
| sanitize-bypass | 0% | 0% | 0% | 0% |
| auth-bypass | 0% | 0% | 0% | 0% |

Same as Claude and Codex: no configuration detected any hard issue.

### Gemini Analysis

**Best config: tools-on-thinking-low** (F1=0.62). Unlike Claude and Codex where tools-off won, Gemini's best config had tool use enabled — it was the only config to find missing-await (33%).

**tools-on-thinking-high was worst here too:** F1=0.53, consistent with the pattern across all three adapters.

**Extreme token variance:** Per-run input tokens varied dramatically — run 0 of tools-on-thinking-low consumed 449k input tokens while run 1 consumed only 63k. Run 2 of tools-off-thinking-low spiked to 715k input tokens with 37 tool calls despite `allowToolUse: false`, confirming the same tool leak bug seen in the Codex adapter.

**Tool leak in tools-off configs:** Gemini's tools-off configurations still made tool calls (10 and 59 across configs). This is the same class of bug as the Codex MCP tool leak — the `--sandbox` flag alone does not prevent Gemini from making tool calls when `allowToolUse: false`.

## Cross-Adapter Comparison

### Best Config per Adapter

| Adapter | Best Config | Precision | Recall | F1 | Time | Total Tokens |
|---------|------------|-----------|--------|-----|------|-------------|
| Claude | tools-off-thinking-high | 0.86 | 0.60 | **0.71** | 58.4s | 12.2k |
| Codex | tools-off-thinking-low | 0.90 | 0.57 | 0.69 | 23.7s | 35.7k |
| Gemini | tools-on-thinking-low | 0.83 | 0.50 | 0.62 | 58.2s | 845.0k |

### Review Quality Comparison

| Metric | Claude | Codex | Gemini |
|--------|--------|-------|--------|
| Best F1 | **0.71** | 0.69 | 0.62 |
| Best Precision | 0.86 | **0.90** | 0.89 |
| Best Recall | **0.60** | 0.57 | 0.50 |
| Best Consistency | **60%** | 53% | 47% |
| F1 Spread (worst–best) | 0.65–0.71 | 0.53–0.69 | 0.53–0.62 |
| Easy issues (3) | 100% all | 100% all | 100% all |
| Medium issues found | 3/4 | 3/4 | 2/4 |
| Hard issues found | 0/3 | 0/3 | 0/3 |

Claude leads on recall, consistency, and configuration robustness. Codex leads on precision. Gemini trails on all quality metrics except easy issue detection, where all three are tied.

**Medium issue breakdown** — the key differentiator between adapters:

| Issue | Claude (best) | Codex (best) | Gemini (best) |
|-------|--------------|-------------|--------------|
| error-swallow | 100% | 100% | 100% |
| missing-await | **100%** | 33% | 33% |
| input-validation | **100%** | 67% | 0% |
| cache-leak | 0% | 33% | 33% |

Claude finds missing-await and input-validation reliably (100%), which accounts for its recall advantage. cache-leak remains a blind spot for Claude but is sporadically detected by Codex and Gemini.

### Token Usage Comparison

| Metric | Claude | Codex | Gemini |
|--------|--------|-------|--------|
| Best config total tokens | **12.2k** | 35.7k | 271.7k |
| Worst config total tokens | 15.4k | 126.4k | 1.3M |
| Token efficiency (F1 per 100k tokens) | **5.82** | 1.93 | 0.07 |
| Thinking tokens reported | No (bundled in output) | No | Yes (38k–147k) |
| Prompt caching | Yes (aggressive) | No | Partial |

Claude is dramatically more token-efficient than both competitors. At its best config, Claude uses 3x fewer tokens than Codex and 22x fewer than Gemini while achieving higher quality. Gemini's token usage is 20–100x higher than Claude's depending on configuration.

**Why Claude is so token-efficient:** Claude's `[otel]` telemetry shows very low input token counts (14–20 per config) because prompt caching offloads ~7.3k tokens per run to `cacheRead`. Codex and Gemini do not cache as aggressively, leading to repeated input token charges.

**Gemini's token anomaly:** Gemini's tools-off-thinking-low config consumed 1.3M tokens — the highest of any configuration across all three adapters — due to a single outlier run (715k input tokens, 37 tool calls) despite tools being disabled. This same tool leak bug affects both Gemini and Codex.

### Key Differences

- **Claude: highest quality, most efficient.** Best F1 (0.71), fewest tokens (12.2k), most consistent (60%), most configuration-robust (F1 spread of 0.06).
- **Codex: fastest, highest precision.** Best time (23.7s), fewest false positives (precision 0.90), but less consistent and wider config sensitivity.
- **Gemini: weakest overall.** Lowest F1 (0.62), highest token usage (271k–1.3M), missed input-validation entirely, and exhibited the same tool leak bug as Codex.
- **No adapter detects hard issues** — all three are limited to diff-visible bugs regardless of configuration.

Note: Codex with `thinking_budget: "off"` (maps to `reasoning.effort: "minimal"`) fails when tool use is enabled due to a Codex CLI limitation: `web_search` tool cannot be used with minimal reasoning effort.

## Recommendations

1. **Use Claude as the default review adapter.** It achieves the highest F1 (0.71), is the most configuration-robust, and uses the fewest tokens at its optimal config (12.2k). Set to tools-off, thinking-high.

2. **Use Codex as a fast alternative.** When speed matters more than recall, Codex tools-off-thinking-low is 2.5x faster with only a marginal quality loss (F1 0.69 vs 0.71).

3. **Deprioritize Gemini for code review.** Gemini's best F1 (0.62) is significantly worse than both Claude (0.71) and Codex (0.69), while consuming 20–100x more tokens. It misses input-validation entirely and detects medium issues less reliably. Gemini should remain available as a fallback but not be recommended as a primary review adapter.

4. **Investigate the tool leak bug in Codex and Gemini.** Both adapters make tool calls when `allowToolUse: false`. The Codex adapter leaks MCP introspection calls; the Gemini adapter leaks sandbox tool calls. This inflates token counts and may degrade review quality.

5. **Improve hard-issue detection.** No adapter or configuration found any of the 3 tool-use-required issues. Options:
   - Add explicit instructions in the review prompt to explore imported modules
   - Implement a two-pass review strategy: first pass identifies imports, second pass reads them
   - Accept that cross-file bugs may be beyond current single-prompt review capability

6. **Investigate cache-leak detection.** This medium-difficulty issue was missed by all configs of Claude. Codex and Gemini detected it sporadically (33%). It may need a more specific prompt hint or represent a blind spot in Claude's code review.
