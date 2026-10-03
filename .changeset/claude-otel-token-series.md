---
'agent-validator': patch
---

Claude review token usage is now complete. The OTel parser dropped uncached input on every review (the metric descriptor's `type` swallowed the first data point) and kept only one thread's counters when a review used subagents. It now sums every thread and model series of the latest cumulative export, and after a successful exit reports a complete total (`input_total` + `output`). The Claude adapter mapping version is now `claude-otel-series-v4`.
