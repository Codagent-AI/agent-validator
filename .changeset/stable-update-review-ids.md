---
'agent-validator': patch
---

Keep update-review fix/skip IDs stable while violations are resolved, so the IDs printed by `run --report` or `update-review list` keep pointing to the same violation across review files.
