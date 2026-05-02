import { describe, expect, it } from "bun:test";
import { buildHomebrewFormula } from "../../.github/scripts/homebrew-formula.ts";

describe("homebrew formula generation", () => {
	it("generates an npm-backed formula for agent-validator", () => {
		const formula = buildHomebrewFormula({
			version: "1.10.0",
			tarballUrl: "https://registry.npmjs.org/agent-validator/-/agent-validator-1.10.0.tgz",
			sha256: "a".repeat(64),
		});

		expect(formula).toContain("class AgentValidator < Formula");
		expect(formula).toContain('version "1.10.0"');
		expect(formula).toContain('url "https://registry.npmjs.org/agent-validator/-/agent-validator-1.10.0.tgz"');
		expect(formula).toContain(`sha256 "${"a".repeat(64)}"`);
		expect(formula).toContain('depends_on "node"');
		expect(formula).toContain('system "npm", "install", *std_npm_args');
		expect(formula).toContain('bin.install_symlink libexec.glob("bin/*")');
		expect(formula).toContain('shell_output("#{bin}/agent-validate --version")');
		expect(formula).toContain('shell_output("#{bin}/agent-validator --version")');
	});
});
