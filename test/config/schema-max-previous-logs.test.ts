import { describe, expect, it } from "bun:test";
import { gauntletConfigSchema } from "../../src/config/schema.js";

describe("max_previous_logs config field", () => {
	const baseConfig = {
		cli: { default_preference: ["claude"] },
		entry_points: [{ path: "." }],
	};

	it("defaults to 3 when not specified", () => {
		const result = gauntletConfigSchema.parse(baseConfig);
		expect(result.max_previous_logs).toBe(3);
	});

	it("accepts 0", () => {
		const result = gauntletConfigSchema.parse({ ...baseConfig, max_previous_logs: 0 });
		expect(result.max_previous_logs).toBe(0);
	});

	it("accepts positive integers", () => {
		const result = gauntletConfigSchema.parse({ ...baseConfig, max_previous_logs: 5 });
		expect(result.max_previous_logs).toBe(5);
	});

	it("rejects negative numbers", () => {
		expect(() => gauntletConfigSchema.parse({ ...baseConfig, max_previous_logs: -1 })).toThrow();
	});

	it("rejects non-integer numbers", () => {
		expect(() => gauntletConfigSchema.parse({ ...baseConfig, max_previous_logs: 2.5 })).toThrow();
	});
});
