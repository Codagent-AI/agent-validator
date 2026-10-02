---
'agent-validator': patch
---

Reviews that set `model` now use that model ahead of the adapter model in project or global `cli` settings. This changes behavior for projects that set different models on a review and its adapter; previously the adapter model silently won. The reviewer environment model override remains highest priority.
