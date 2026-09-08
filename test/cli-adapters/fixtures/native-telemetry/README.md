# Recorded provider telemetry

These are sanitized **native CLI recordings**, captured on 2026-09-08 UTC with the owner's explicit authorization during resolution of F09/F11. They are not generated measurements. Tests replay them offline without provider credentials. Capture machine: macOS arm64; orchestrator Bun 1.3.11. CLI source/event versions beyond the named format were not exposed.

| Fixture | CLI / requested model | Capture start → end (UTC) | Native evidence |
| --- | --- | --- | --- |
| `codex-0.153.4.jsonl` | codex-cli 0.153.4 / `gpt-5.6-luna` | 02:01:07.223 → 02:01:11.950 | One successful `turn.completed`: input 12766, cached input 5888, output 5. |
| `claude-2.1.261.txt` | Claude Code 2.1.261 / `haiku` | 02:01:11.977 → 02:01:13.315 | Successful console OTel token metric plus the overlapping API-request event: uncached input 3504, output 4, cache read/write both observed zero. |
| `claude-2.1.261-cache-write.txt` | Claude Code 2.1.261 / `haiku` | 02:01:52.690 → 02:01:54.357 | Successful console OTel token metric plus overlapping API-request event: uncached input 3, output 4, cache read 0, cache creation 7508. Total input is **7511**, not 3. |

All three subprocesses exited 0 without reaching the timeout or output bound. Model names above are requested configuration, not proof of effective identity. No tool activity is part of the retained evidence.

## Collection and sanitization

The captures used a disposable directory outside all repositories and a short synthetic completion request. The cache-write case additionally supplied repeated inert synthetic system padding to reach a cacheable prefix. No repository content was supplied. Both CLIs disabled session persistence. Raw stdout/stderr was bounded to 2 MiB in memory, never written to a capture file, then discarded after allowlisting. The subprocess-group timeout was 90 seconds.

Codex used `exec --json --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox read-only`, low reasoning, disabled shell/shell snapshots/multi-agent/web search, and zero project-document bytes. The installed CLI did not provide a dollar cap; only one successful short turn was collected, with no outer retry after success. Two earlier startup failures while configuring provider retry overrides emitted no completion telemetry; their consumption is not inferred as zero. The successful call omitted those incompatible overrides, so provider-internal retry counts are not established. Codex did not report a dollar cost.

Claude used print/text mode, safe mode, no tools, empty strict MCP configuration, no session persistence, one maximum turn, a $0.50 CLI budget setting, a 256 output-token setting, and disabled thinking. Console OTel metric/log exporters were enabled with 100 ms intervals; prompt/tool-detail telemetry was disabled. The budget setting is not a guarantee of the final billed charge. A preliminary successful JSON-output call emitted result usage but no OTel blocks at the initial long export interval; it is not a source fixture. Across the three Claude calls, the CLI-reported cost amounts sum to approximately $0.022087; this is source-reported evidence, not reconciled billing.

Codex retains only the completion type and allowlisted numeric usage properties, JSON-reserialized. Claude retains original numeric values, quoting and structural lines for the token metric and API-request event. Other scalar lines were deleted; empty structural containers remain. Prompts, responses, unrestricted events, credentials, environment values, account/user/session/request identities, emails, host/resource labels, model labels, and timestamps from provider payloads were not retained. Do not infer an observed model from these stripped fixtures.

SHA-256 of raw stdout followed by raw stderr (raw streams are deliberately not retained):

- Codex: `7318a86013d5f15d856a1e568e8ef8a6d86c1c96d865f8595b1bb542f4055d4c`
- Claude baseline: `6aa1002de69ed06392b1f96dc9258a45bc40f30418775573e2a51ccfd1129195`
- Claude cache write: `96ce37cf35fe58fe4b983922b2ba24e0cd5fc9da9f15a49df43f8e6a159dea03`

SHA-256 of the sanitized fixture bytes, including final newline:

- Codex: `bf09ca3cfd0ba08d5c42b82f45ef16637154e266b0db7e951c0a153f3f4396be`
- Claude baseline: `d281cbecba40d674154f96c97f457caf969c7cf0f32ff352490b400f5e57841f`
- Claude cache write: `8694462247f68892e6bb954c16a29d34d2ea0a9f7084c173163fc4836b68096b`

## Accounting review and limits

- [Codex non-interactive event documentation](https://learn.chatgpt.com/docs/non-interactive-mode) identifies the native completion usage structure. [OpenAI Responses usage](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) places cached tokens inside input-token details and reports input/output separately. Together with the native completion, this supports input 12766 (including 5888 cached) plus output 5 = normalized 12771. Do not add cached input again. The retained reasoning-output field is not mapped by the current adapter; it remains an explicit support limitation.
- [Claude monitoring documentation](https://code.claude.com/docs/en/monitoring-usage) connects API-request input to the API usage block. [Anthropic's cache accounting definition](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance) defines uncached input, cache read and cache creation as disjoint components of total input. This establishes the derivation for the recorded cache-write case. Metric and API event counts are identical observations of the same request, not additive work.
- Claude mapping `claude-otel-accounting-v2` fixes the earlier mapping of uncached input as total input and accepts numeric as well as quoted integer API fields. Native counters retain their original names and values. All required input components must be present before deriving total input; missing values are not zeros. Collection remains partial, and the normalized grand total, effective identity, reasoning, cost scope, multi-model counter aggregation, interrupted collection and full-run coverage are not established by these successful single-request captures.
- These fixtures establish the required successful Codex/Claude accounting baseline, not completion of AT-001/AT-002. The independent acceptance tester must still replay measured usage through the built CLI, failed/retried validation and delivery flows. Test-generated review responses, process exits or truncated variations must be labeled synthetic control data; never relabel them as provider-recorded outcomes.
