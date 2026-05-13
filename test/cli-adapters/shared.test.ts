import { describe, expect, it } from "bun:test";
import { open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finalizeProcessClose } from "../../src/cli-adapters/shared.js";

describe("finalizeProcessClose", () => {
	it("rejects when a process exits because of a signal", async () => {
		const file = path.join(
			os.tmpdir(),
			`agent-validator-finalize-${process.pid}-${Date.now()}.tmp`,
		);
		await writeFile(file, "");
		const handle = await open(file, "r");

		let rejected: Error | undefined;
		await finalizeProcessClose({
			code: null,
			signal: "SIGTERM",
			handle,
			cleanup: async () => {
				await rm(file, { force: true });
			},
			chunks: ["partial"],
			getStderr: () => "",
			resolve: () => {},
			reject: (error) => {
				rejected = error;
			},
		});

		expect(rejected?.message).toContain("Process terminated by signal SIGTERM");
	});
});
