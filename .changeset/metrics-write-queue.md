---
'agent-validator': patch
---

Parallel reviews no longer lose a final attempt record on slow metrics storage. Writes from one validator process now take turns through an in-process queue instead of spinning against each other on the metadata lock, so its 2 second deadline only applies to contention with other processes. Live-progress telemetry keeps only the newest unwritten snapshot per attempt, and the terminal write supersedes it. A terminal write that fails is retried with backoff, and if it still fails the validator prints a warning with the saved reasons instead of degrading silently.
