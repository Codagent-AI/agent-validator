import { describe, expect, it } from "bun:test";
import {
	reviewPromptFrontmatterSchema,
	reviewYamlSchema,
} from "../../src/config/schema.js";

describe("Review schemas - enabled field", () => {
	describe("reviewYamlSchema", () => {
		it("defaults enabled to true when not specified (builtin only)", () => {
			const result = reviewYamlSchema.parse({ builtin: "code-quality" });
			expect(result.enabled).toBe(true);
		});

		it("accepts enabled: false and preserves it", () => {
			const result = reviewYamlSchema.parse({
				builtin: "code-quality",
				enabled: false,
			});
			expect(result.enabled).toBe(false);
		});

		it("accepts enabled: true explicitly", () => {
			const result = reviewYamlSchema.parse({
				builtin: "code-quality",
				enabled: true,
			});
			expect(result.enabled).toBe(true);
		});
	});

	describe("reviewPromptFrontmatterSchema", () => {
		it("defaults enabled to true when not specified", () => {
			const result = reviewPromptFrontmatterSchema.parse({});
			expect(result.enabled).toBe(true);
		});

		it("accepts enabled: false in frontmatter", () => {
			const result = reviewPromptFrontmatterSchema.parse({ enabled: false });
			expect(result.enabled).toBe(false);
		});

		it("accepts enabled: true explicitly", () => {
			const result = reviewPromptFrontmatterSchema.parse({ enabled: true });
			expect(result.enabled).toBe(true);
		});
	});
});
