# Model measurement contract v1

This directory is the language-neutral contract owned by Agent Validator. Consumers pin this directory's version and fixture manifest; they must not depend on Validator's TypeScript types.

`measurement_schema_version` is `1`. It is independent from the standalone artifact, handoff protocol, capabilities, and private storage versions. New fields, including optional fields, require a new owning schema version. v1 objects are closed: unknown fields are rejected and no extension bag is allowed.

This release supports only measurement v1. Unsupported latest revisions do not contribute to v1 aggregates, cannot be enabled by a caller's compatibility list, and leave explicit incomplete-coverage diagnostics; an older v1 revision is never substituted. A future version needs a separately reviewed source-to-target mapping, provenance and compatibility fixtures before cross-version aggregation can be enabled. No such conversion is implemented or advertised here.

Measurements use an explicit availability envelope. Available zero is an observed or derived `0`; unavailable is `null` with a reason. `origin`, `precision`, source, derivation, and inclusion relationships are independent. A normalized total is only present when known components are non-overlapping. Validator never estimates prices; `provider_reported_costs` is source evidence only.

Export records are complete replacement revisions. Their SHA-256 digest is over RFC 8785 JCS UTF-8 bytes of the complete record excluding only its top-level `digest`. The fixture manifest pins original JSON, canonical bytes, digests, rejection cases, and semantic intent. Fixtures are synthetic canonicalization inputs, not evidence of provider accounting behavior.
