import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import {
	appendRecord,
	getLedgerPath,
	isTrusted,
	readRecords,
	type TrustRecord,
} from "../../src/utils/trust-ledger.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-trust-ledger");

function createMockSpawn(stdout: string, exitCode = 0, stderr = "") {
	const mockProcess = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
	};
	mockProcess.stdout = new EventEmitter();
	mockProcess.stderr = new EventEmitter();

	setImmediate(() => {
		if (stdout) mockProcess.stdout.emit("data", Buffer.from(stdout));
		if (stderr) mockProcess.stderr.emit("data", Buffer.from(stderr));
		mockProcess.emit("close", exitCode);
	});

	return mockProcess;
}

function record(overrides: Partial<TrustRecord> = {}): TrustRecord {
	return {
		commit: "abc123",
		tree: "tree123",
		config_hash: "config",
		scope: {
			command: "run",
			gates: [],
			entry_points: [],
			cli_overrides: {},
		},
		scope_hash: "scope",
		validator_version: "1.10.0",
		source: "validated",
		status: "passed",
		trusted: true,
		created_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("trust ledger", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
		spyOn(childProcess, "spawn").mockImplementation(((cmd, args) => {
			if (cmd === "git" && Array.isArray(args)) {
				if (args.join(" ") === "rev-parse --git-common-dir") {
					return createMockSpawn(`${TEST_DIR}/.git\n`) as ReturnType<
						typeof childProcess.spawn
					>;
				}
				if (args.join(" ") === "status --porcelain") {
					return createMockSpawn("") as ReturnType<typeof childProcess.spawn>;
				}
			}
			return createMockSpawn("") as ReturnType<typeof childProcess.spawn>;
		}) as typeof childProcess.spawn);
	});

	afterEach(async () => {
		mock.restore();
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("resolves the shared ledger path under git common dir", async () => {
		await expect(getLedgerPath()).resolves.toBe(
			path.join(TEST_DIR, ".git", "agent-validator", "trusted-snapshots.jsonl"),
		);
	});

	it("creates the ledger directory on first append and skips corrupt lines on read", async () => {
		await appendRecord(record());
		const ledgerPath = await getLedgerPath();
		await fs.appendFile(ledgerPath, "not-json\n", "utf-8");
		await fs.appendFile(
			ledgerPath,
			`${JSON.stringify(record({ commit: "def456", tree: "tree456" }))}\n`,
			"utf-8",
		);

		const records = await readRecords();

		expect(records.map((r) => r.commit)).toEqual(["abc123", "def456"]);
	});

	it("trusts by commit before tree", async () => {
		await appendRecord(record({ commit: "abc123", tree: "old-tree" }));
		await appendRecord(record({ commit: null, tree: "tree123" }));

		const result = await isTrusted("abc123", "tree123");

		expect(result.trusted).toBe(true);
		expect(result.matchType).toBe("commit");
		expect(result.record?.commit).toBe("abc123");
	});

	it("trusts by tree on a clean worktree when no commit record exists", async () => {
		await appendRecord(record({ commit: null, tree: "tree123" }));

		const result = await isTrusted("newcommit", "tree123");

		expect(result.trusted).toBe(true);
		expect(result.matchType).toBe("tree");
	});

	it("does not trust by tree on a dirty worktree", async () => {
		mock.restore();
		spyOn(childProcess, "spawn").mockImplementation(((cmd, args) => {
			if (cmd === "git" && Array.isArray(args)) {
				if (args.join(" ") === "rev-parse --git-common-dir") {
					return createMockSpawn(`${TEST_DIR}/.git\n`) as ReturnType<
						typeof childProcess.spawn
					>;
				}
				if (args.join(" ") === "status --porcelain") {
					return createMockSpawn(" M src/index.ts\n") as ReturnType<
						typeof childProcess.spawn
					>;
				}
			}
			return createMockSpawn("") as ReturnType<typeof childProcess.spawn>;
		}) as typeof childProcess.spawn);
		await appendRecord(record({ commit: null, tree: "tree123" }));

		const result = await isTrusted("newcommit", "tree123");

		expect(result.trusted).toBe(false);
		expect(result.matchType).toBeNull();
	});
});
