import { describe, expect, it } from "bun:test";
import type { LoadedCheckGateConfig } from "../../src/config/types";
import { CheckGateExecutor } from "../../src/gates/check";
import { checkGateSchema } from "../../src/config/schema";

const noopLogger = async (_output: string) => {};

function makeConfig(
	overrides: Partial<LoadedCheckGateConfig> = {},
): LoadedCheckGateConfig {
	return {
		name: "test-check",
		command: "echo first-run",
		parallel: false,
		run_locally: true,
		...overrides,
	} as LoadedCheckGateConfig;
}

describe("CheckGateExecutor rerun_command", () => {
	const executor = new CheckGateExecutor();

	it("uses rerun_command when isRerun=true and rerun_command is defined", async () => {
		const config = makeConfig({
			command: "echo first-run",
			rerun_command: "echo rerun",
		});

		const result = await executor.execute(
			"job-1",
			config,
			".",
			noopLogger,
			{ isRerun: true },
		);

		expect(result.status).toBe("pass");
	});

	it("falls back to command when isRerun=true but rerun_command is not defined", async () => {
		const config = makeConfig({
			command: "echo first-run",
		});

		const result = await executor.execute(
			"job-2",
			config,
			".",
			noopLogger,
			{ isRerun: true },
		);

		expect(result.status).toBe("pass");
	});

	it("uses command when isRerun=false even if rerun_command is defined", async () => {
		const config = makeConfig({
			command: "echo first-run",
			rerun_command: "echo rerun",
		});

		const result = await executor.execute(
			"job-3",
			config,
			".",
			noopLogger,
			{ isRerun: false },
		);

		expect(result.status).toBe("pass");
	});

	it("applies variable substitution to rerun_command", async () => {
		const config = makeConfig({
			command: "echo cmd-${BASE_BRANCH}",
			rerun_command: "echo rerun-${BASE_BRANCH}",
		});

		const logs: string[] = [];
		const capturingLogger = async (output: string) => {
			logs.push(output);
		};

		await executor.execute(
			"job-4",
			config,
			".",
			capturingLogger,
			{ baseBranch: "origin/main", isRerun: true },
		);

		// The executed command should have substituted BASE_BRANCH
		const commandLog = logs.find((l) =>
			l.startsWith("Executing command:"),
		);
		expect(commandLog).toContain("rerun-origin/main");
	});
});

describe("checkGateSchema rerun_command", () => {
	it("accepts config with rerun_command", () => {
		const result = checkGateSchema.safeParse({
			command: "echo test",
			rerun_command: "echo rerun",
		});
		expect(result.success).toBe(true);
	});

	it("accepts config without rerun_command", () => {
		const result = checkGateSchema.safeParse({
			command: "echo test",
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty rerun_command string", () => {
		const result = checkGateSchema.safeParse({
			command: "echo test",
			rerun_command: "",
		});
		expect(result.success).toBe(false);
	});
});
