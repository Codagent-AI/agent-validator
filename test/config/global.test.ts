import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// We need to test with a custom path, so we'll test the schema validation directly
// and mock the file system for integration tests

describe("Global Configuration", () => {
	describe("Schema Validation", () => {
		it("should accept valid configuration", async () => {
			// Import the module fresh to test schema
			const { loadGlobalConfig } = await import("../../src/config/global.js");
			// loadGlobalConfig reads from user's actual global config if it exists
			// We just verify the structure is valid
			const config = await loadGlobalConfig();
			expect(typeof config.debug_log.enabled).toBe("boolean");
			expect(typeof config.debug_log.max_size_mb).toBe("number");
		});

		it("should have correct default values", async () => {
			const { loadGlobalConfig, DEFAULT_GLOBAL_CONFIG } = await import(
				"../../src/config/global.js"
			);
			// Test the DEFAULT_GLOBAL_CONFIG constant directly to verify defaults
			// This avoids interference from user's actual global config file
			expect(DEFAULT_GLOBAL_CONFIG.debug_log).toBeDefined();
			expect(DEFAULT_GLOBAL_CONFIG.debug_log.enabled).toBe(false);
			expect(DEFAULT_GLOBAL_CONFIG.debug_log.max_size_mb).toBe(10);
		});
	});

	describe("getGlobalConfigPath", () => {
		it("returns correct path in home directory", async () => {
			const { getGlobalConfigPath } = await import(
				"../../src/config/global.js"
			);
			const configPath = getGlobalConfigPath();
			expect(configPath).toContain(".config");
			expect(configPath).toContain("agent-gauntlet");
			expect(configPath).toContain("config.yml");
		});
	});
});
