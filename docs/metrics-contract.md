---
title: Metrics Contract
group: Reference
order: 80
description: Versioned model-measurement and standalone-artifact contracts.
---

# Metrics Contract

Agent Validator's metrics foundation uses closed, versioned JSON contracts in `contracts/`. The v1 delivery defines independent versions for measurements, standalone artifacts, the export protocol, capabilities, and private storage. A newer record version never rewrites or relabels retained evidence.

Every token field is either available with a value or unavailable with a reason. Unavailable is not zero. Provider-native usage remains separate from normalized fields, and normalized totals are only produced where overlap is established. Cached input and reasoning included by a containing field are not counted twice.

Model attempts carry requested, resolved, and observed identities separately. Allocation and cost references use stable attempt-local IDs. Costs are pass-through provider evidence with currency, coverage, and scope; Validator does not look up rates or estimate a price.

The export digest is SHA-256 over RFC 8785 canonical UTF-8 JSON for the complete replacement record except its top-level `digest` member. The pinned compatibility fixtures include original input, canonical bytes, expected hashes, and rejection cases. Consumers should pin a reviewed contract version and run those fixtures in their own implementation.

This foundation does not itself publish snapshots, persist receipts, or implement the metrics CLI. Targeted Runner and Evals confirmation and their real shared-fixture executions remain outstanding integration prerequisites.
