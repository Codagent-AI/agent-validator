import { describe, expect, it } from "bun:test";
import { validatorConfigSchema } from "../../src/config/schema.js";

describe("max_previous_logs config field", () => {
	const baseConfig = {
		cli: { default_preference: ["claude"] },
		entry_points: [{ path: "." }],
	};

	it("defaults to 3 when not specified", () => {
		const result = validatorConfigSchema.parse(baseConfig);
		expect(result.max_previous_logs).toBe(3);
	});

	it("accepts 0", () => {
		const result = validatorConfigSchema.parse({ ...baseConfig, max_previous_logs: 0 });
		expect(result.max_previous_logs).toBe(0);
	});

	it("accepts positive integers", () => {
		const result = validatorConfigSchema.parse({ ...baseConfig, max_previous_logs: 5 });
		expect(result.max_previous_logs).toBe(5);
	});

	it("rejects negative numbers", () => {
		expect(() => validatorConfigSchema.parse({ ...baseConfig, max_previous_logs: -1 })).toThrow();
	});

	it("rejects non-integer numbers", () => {
		expect(() => validatorConfigSchema.parse({ ...baseConfig, max_previous_logs: 2.5 })).toThrow();
	});
});
