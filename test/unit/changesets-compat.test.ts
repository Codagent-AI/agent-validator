import { describe, expect, it } from "bun:test";
import parseChangeset from "@changesets/parse";

describe("changesets compatibility", () => {
	it("parses changeset frontmatter with the pinned js-yaml override", () => {
		const parsed = parseChangeset(`---
"agent-validator": patch
---

Exercise the Changesets parser used by release tooling.
`);

		expect(parsed.releases).toEqual([
			{ name: "agent-validator", type: "patch" },
		]);
		expect(parsed.summary).toBe(
			"Exercise the Changesets parser used by release tooling.",
		);
	});
});
