import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_GLOBAL_CONFIG } from "../../src/config/global.js";
import {
	GAUNTLET_AUTO_PUSH_PR,
	GAUNTLET_STOP_HOOK_ENABLED,
	GAUNTLET_STOP_HOOK_INTERVAL_MINUTES,
	parseStopHookEnvVars,
	resolveStopHookConfig,
} from "../../src/config/stop-hook-config.js";

describe("stop-hook-config", () => {
	describe("parseStopHookEnvVars", () => {
		let originalEnabled: string | undefined;
		let originalInterval: string | undefined;
		let originalAutoPushPr: string | undefined;

		beforeEach(() => {
			originalEnabled = process.env[GAUNTLET_STOP_HOOK_ENABLED];
			originalInterval = process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES];
			originalAutoPushPr = process.env[GAUNTLET_AUTO_PUSH_PR];
		});

		afterEach(() => {
			if (originalEnabled === undefined) {
				delete process.env[GAUNTLET_STOP_HOOK_ENABLED];
			} else {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = originalEnabled;
			}
			if (originalInterval === undefined) {
				delete process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES];
			} else {
				process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = originalInterval;
			}
			if (originalAutoPushPr === undefined) {
				delete process.env[GAUNTLET_AUTO_PUSH_PR];
			} else {
				process.env[GAUNTLET_AUTO_PUSH_PR] = originalAutoPushPr;
			}
		});

		it("returns empty object when no env vars set", () => {
			delete process.env[GAUNTLET_STOP_HOOK_ENABLED];
			delete process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES];
			delete process.env[GAUNTLET_AUTO_PUSH_PR];
			const result = parseStopHookEnvVars();
			expect(result.enabled).toBeUndefined();
			expect(result.run_interval_minutes).toBeUndefined();
			expect(result.auto_push_pr).toBeUndefined();
		});

		describe("enabled parsing", () => {
			it("accepts 'true' as truthy", () => {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = "true";
				const result = parseStopHookEnvVars();
				expect(result.enabled).toBe(true);
			});

			it("accepts '1' as truthy", () => {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = "1";
				const result = parseStopHookEnvVars();
				expect(result.enabled).toBe(true);
			});

			it("accepts 'false' as falsy", () => {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = "false";
				const result = parseStopHookEnvVars();
				expect(result.enabled).toBe(false);
			});

			it("accepts '0' as falsy", () => {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = "0";
				const result = parseStopHookEnvVars();
				expect(result.enabled).toBe(false);
			});

			it("ignores invalid values", () => {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = "invalid";
				const result = parseStopHookEnvVars();
				expect(result.enabled).toBeUndefined();
			});

			it("handles case insensitivity", () => {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = "TRUE";
				const result = parseStopHookEnvVars();
				expect(result.enabled).toBe(true);
			});

			it("handles whitespace", () => {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = "  true  ";
				const result = parseStopHookEnvVars();
				expect(result.enabled).toBe(true);
			});
		});

		describe("interval parsing", () => {
			it("accepts valid positive integers", () => {
				process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = "15";
				const result = parseStopHookEnvVars();
				expect(result.run_interval_minutes).toBe(15);
			});

			it("accepts zero (always run)", () => {
				process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = "0";
				const result = parseStopHookEnvVars();
				expect(result.run_interval_minutes).toBe(0);
			});

			it("ignores negative values", () => {
				process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = "-5";
				const result = parseStopHookEnvVars();
				expect(result.run_interval_minutes).toBeUndefined();
			});

			it("ignores non-numeric values", () => {
				process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = "abc";
				const result = parseStopHookEnvVars();
				expect(result.run_interval_minutes).toBeUndefined();
			});

			it("ignores float values", () => {
				process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = "10.5";
				const result = parseStopHookEnvVars();
				expect(result.run_interval_minutes).toBeUndefined();
			});

			it("ignores partial numeric values like '10abc'", () => {
				process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = "10abc";
				const result = parseStopHookEnvVars();
				expect(result.run_interval_minutes).toBeUndefined();
			});
		});

		describe("auto_push_pr parsing", () => {
			it("accepts 'true' as truthy", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "true";
				const result = parseStopHookEnvVars();
				expect(result.auto_push_pr).toBe(true);
			});

			it("accepts '1' as truthy", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "1";
				const result = parseStopHookEnvVars();
				expect(result.auto_push_pr).toBe(true);
			});

			it("accepts 'false' as falsy", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "false";
				const result = parseStopHookEnvVars();
				expect(result.auto_push_pr).toBe(false);
			});

			it("accepts '0' as falsy", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "0";
				const result = parseStopHookEnvVars();
				expect(result.auto_push_pr).toBe(false);
			});

			it("ignores invalid values", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "invalid";
				const result = parseStopHookEnvVars();
				expect(result.auto_push_pr).toBeUndefined();
			});

			it("handles case insensitivity", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "TRUE";
				const result = parseStopHookEnvVars();
				expect(result.auto_push_pr).toBe(true);
			});

			it("handles whitespace", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "  true  ";
				const result = parseStopHookEnvVars();
				expect(result.auto_push_pr).toBe(true);
			});
		});
	});

	describe("resolveStopHookConfig", () => {
		let originalEnabled: string | undefined;
		let originalInterval: string | undefined;
		let originalAutoPushPr: string | undefined;

		beforeEach(() => {
			originalEnabled = process.env[GAUNTLET_STOP_HOOK_ENABLED];
			originalInterval = process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES];
			originalAutoPushPr = process.env[GAUNTLET_AUTO_PUSH_PR];
			delete process.env[GAUNTLET_STOP_HOOK_ENABLED];
			delete process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES];
			delete process.env[GAUNTLET_AUTO_PUSH_PR];
		});

		afterEach(() => {
			if (originalEnabled === undefined) {
				delete process.env[GAUNTLET_STOP_HOOK_ENABLED];
			} else {
				process.env[GAUNTLET_STOP_HOOK_ENABLED] = originalEnabled;
			}
			if (originalInterval === undefined) {
				delete process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES];
			} else {
				process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = originalInterval;
			}
			if (originalAutoPushPr === undefined) {
				delete process.env[GAUNTLET_AUTO_PUSH_PR];
			} else {
				process.env[GAUNTLET_AUTO_PUSH_PR] = originalAutoPushPr;
			}
		});

		it("uses global config when no project config or env vars", () => {
			const result = resolveStopHookConfig(undefined, DEFAULT_GLOBAL_CONFIG);
			expect(result.enabled).toBe(true);
			expect(result.run_interval_minutes).toBe(5);
			expect(result.auto_push_pr).toBe(false);
		});

		it("project config overrides global config", () => {
			const projectConfig = { enabled: false, run_interval_minutes: 5 };
			const result = resolveStopHookConfig(
				projectConfig,
				DEFAULT_GLOBAL_CONFIG,
			);
			expect(result.enabled).toBe(false);
			expect(result.run_interval_minutes).toBe(5);
		});

		it("env var overrides both project and global config", () => {
			process.env[GAUNTLET_STOP_HOOK_ENABLED] = "false";
			process.env[GAUNTLET_STOP_HOOK_INTERVAL_MINUTES] = "0";
			const projectConfig = { enabled: true, run_interval_minutes: 5 };
			const result = resolveStopHookConfig(
				projectConfig,
				DEFAULT_GLOBAL_CONFIG,
			);
			expect(result.enabled).toBe(false);
			expect(result.run_interval_minutes).toBe(0);
		});

		it("per-field independent resolution", () => {
			// env var sets enabled, project config sets interval
			process.env[GAUNTLET_STOP_HOOK_ENABLED] = "true";
			const projectConfig = { run_interval_minutes: 5 };
			const globalConfig = {
				...DEFAULT_GLOBAL_CONFIG,
				stop_hook: { enabled: false, run_interval_minutes: 5 },
			};
			const result = resolveStopHookConfig(projectConfig, globalConfig);
			expect(result.enabled).toBe(true); // from env var
			expect(result.run_interval_minutes).toBe(5); // from project config
		});

		it("falls through when env var is invalid", () => {
			process.env[GAUNTLET_STOP_HOOK_ENABLED] = "invalid";
			const projectConfig = { enabled: false };
			const result = resolveStopHookConfig(
				projectConfig,
				DEFAULT_GLOBAL_CONFIG,
			);
			expect(result.enabled).toBe(false); // from project config, since env is invalid
		});

		it("backwards compatibility: missing enabled defaults to true", () => {
			const projectConfig = { run_interval_minutes: 5 }; // no enabled field
			const result = resolveStopHookConfig(
				projectConfig,
				DEFAULT_GLOBAL_CONFIG,
			);
			expect(result.enabled).toBe(true); // default from global
			expect(result.run_interval_minutes).toBe(5); // from project
		});

		describe("auto_push_pr 3-tier resolution", () => {
			it("defaults to false when not configured anywhere", () => {
				const result = resolveStopHookConfig(undefined, DEFAULT_GLOBAL_CONFIG);
				expect(result.auto_push_pr).toBe(false);
			});

			it("project config overrides global config", () => {
				const projectConfig = { auto_push_pr: true };
				const result = resolveStopHookConfig(
					projectConfig,
					DEFAULT_GLOBAL_CONFIG,
				);
				expect(result.auto_push_pr).toBe(true);
			});

			it("env var overrides project config", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "false";
				const projectConfig = { auto_push_pr: true };
				const result = resolveStopHookConfig(
					projectConfig,
					DEFAULT_GLOBAL_CONFIG,
				);
				expect(result.auto_push_pr).toBe(false);
			});

			it("env var true overrides project false", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "true";
				const projectConfig = { auto_push_pr: false };
				const result = resolveStopHookConfig(
					projectConfig,
					DEFAULT_GLOBAL_CONFIG,
				);
				expect(result.auto_push_pr).toBe(true);
			});

			it("falls through when env var is invalid", () => {
				process.env[GAUNTLET_AUTO_PUSH_PR] = "invalid";
				const projectConfig = { auto_push_pr: true };
				const result = resolveStopHookConfig(
					projectConfig,
					DEFAULT_GLOBAL_CONFIG,
				);
				expect(result.auto_push_pr).toBe(true); // from project config
			});
		});
	});
});
