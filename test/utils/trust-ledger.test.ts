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
	appendCurrentTrustRecord,
	buildTrustRecord,
	getLedgerPath,
	isTrusted,
	pruneIfNeeded,
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

function config(overrides: Record<string, unknown> = {}) {
	return {
		project: {
			base_branch: "origin/main",
			log_dir: path.join(TEST_DIR, "logs"),
			max_retries: 3,
			max_previous_logs: 5,
			debug_log: { enabled: true },
			cli: {
				default_preference: ["codex"],
				adapters: {
					codex: { model: "gpt-5" },
				},
			},
			entry_points: [
				{
					path: "src/**/*.ts",
					checks: ["lint"],
					reviews: ["code-quality"],
				},
			],
			...overrides,
		},
		checks: {
			lint: { name: "lint", command: "bun test" },
		},
		reviews: {
			"code-quality": {
				name: "code-quality",
				prompt: "code-quality.md",
				num_reviews: 1,
				parallel: true,
				run_in_ci: true,
				run_locally: true,
				enabled: true,
			},
		},
	} as any;
}

async function readLedgerLines(): Promise<string[]> {
	const ledgerPath = await getLedgerPath();
	const content = await fs.readFile(ledgerPath, "utf-8");
	return content.split("\n").filter(Boolean);
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
				if (args.join(" ") === "rev-parse HEAD") {
					return createMockSpawn("commit123\n") as ReturnType<
						typeof childProcess.spawn
					>;
				}
				if (args.join(" ") === "rev-parse HEAD^{tree}") {
					return createMockSpawn("tree123\n") as ReturnType<
						typeof childProcess.spawn
					>;
				}
				if (args.join(" ") === "rev-list --all") {
					return createMockSpawn("abc123\nreachable\n") as ReturnType<
						typeof childProcess.spawn
					>;
				}
				if (args.join(" ") === "cat-file -t dirty-ref") {
					return createMockSpawn("commit\n") as ReturnType<
						typeof childProcess.spawn
					>;
				}
				if (args.join(" ") === "cat-file -t missing-ref") {
					return createMockSpawn("", 1, "fatal: Not a valid object name") as ReturnType<
						typeof childProcess.spawn
					>;
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

	it("writes a clean partial gate pass as an untrusted narrowed-scope record", async () => {
		await fs.mkdir(path.join(TEST_DIR, "logs"), { recursive: true });
		await fs.writeFile(
			path.join(TEST_DIR, "logs", ".execution_state"),
			JSON.stringify({
				last_run_completed_at: "2026-01-01T00:00:00.000Z",
				branch: "main",
				commit: "commit123",
				working_tree_ref: "commit123",
			}),
			"utf-8",
		);

		await appendCurrentTrustRecord({
			config: config(),
			logDir: path.join(TEST_DIR, "logs"),
			command: "run",
			status: "passed",
			source: "validated",
			options: { gate: "lint" },
		});

		const [written] = await readRecords();
		expect(written.commit).toBe("commit123");
		expect(written.tree).toBe("tree123");
		expect(written.trusted).toBe(false);
		expect(written.scope.cli_overrides).toEqual({ gate: "lint" });
		expect(written.scope.gates).toEqual(["lint"]);
	});

	it("writes dirty manual-skip records using the stored working tree ref", async () => {
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
				if (args.join(" ") === "rev-parse dirty-ref^{tree}") {
					return createMockSpawn("dirty-tree\n") as ReturnType<
						typeof childProcess.spawn
					>;
				}
			}
			return createMockSpawn("") as ReturnType<typeof childProcess.spawn>;
		}) as typeof childProcess.spawn);
		await fs.mkdir(path.join(TEST_DIR, "logs"), { recursive: true });
		await fs.writeFile(
			path.join(TEST_DIR, "logs", ".execution_state"),
			JSON.stringify({
				last_run_completed_at: "2026-01-01T00:00:00.000Z",
				branch: "main",
				commit: "commit123",
				working_tree_ref: "dirty-ref",
			}),
			"utf-8",
		);

		await appendCurrentTrustRecord({
			config: config(),
			logDir: path.join(TEST_DIR, "logs"),
			command: "skip",
			status: "skipped",
			source: "manual-skip",
			trusted: true,
		});

		const [written] = await readRecords();
		expect(written.commit).toBeNull();
		expect(written.tree).toBe("dirty-tree");
		expect(written.working_tree_ref).toBe("dirty-ref");
		expect(written.source).toBe("manual-skip");
		expect(written.trusted).toBe(true);
	});

	it("does not write records for failed outcomes", async () => {
		await appendCurrentTrustRecord({
			config: config(),
			logDir: path.join(TEST_DIR, "logs"),
			command: "run",
			status: "failed",
			source: "validated",
		});

		expect(await readRecords()).toEqual([]);
	});

	it("logs and swallows ledger preparation failures", async () => {
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
				if (args.join(" ") === "rev-parse HEAD") {
					return createMockSpawn("commit123\n") as ReturnType<
						typeof childProcess.spawn
					>;
				}
				if (args.join(" ") === "rev-parse HEAD^{tree}") {
					return createMockSpawn(
						"",
						1,
						"fatal: ambiguous argument HEAD^{tree}",
					) as ReturnType<typeof childProcess.spawn>;
				}
			}
			return createMockSpawn("") as ReturnType<typeof childProcess.spawn>;
		}) as typeof childProcess.spawn);
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});

		await expect(
			appendCurrentTrustRecord({
				config: config(),
				logDir: path.join(TEST_DIR, "logs"),
				command: "run",
				status: "passed",
				source: "validated",
			}),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("prunes unreachable commits and missing dirty refs atomically", async () => {
		await appendRecord(record({ commit: "abc123", tree: "kept-commit" }));
		await appendRecord(record({ commit: "unreachable", tree: "removed-commit" }));
		await appendRecord(
			record({ commit: null, tree: "kept-dirty", working_tree_ref: "dirty-ref" }),
		);
		await appendRecord(
			record({
				commit: null,
				tree: "removed-dirty",
				working_tree_ref: "missing-ref",
			}),
		);

		await pruneIfNeeded(2);

		const records = await readRecords();
		expect(records.map((r) => r.tree)).toEqual(["kept-commit", "kept-dirty"]);
		expect(await readLedgerLines()).toHaveLength(2);
	});

	it("records config hash for gate-affecting fields but excludes operational fields", () => {
		const base = buildTrustRecord({
			config: config(),
			command: "run",
			source: "validated",
			status: "passed",
			trusted: true,
			commit: "commit123",
			tree: "tree123",
		});
		const operationalChange = buildTrustRecord({
			config: config({
				log_dir: "/tmp/other",
				max_retries: 9,
				debug_log: { enabled: false },
			}),
			command: "run",
			source: "validated",
			status: "passed",
			trusted: true,
			commit: "commit123",
			tree: "tree123",
		});
		const gateAffectingChange = buildTrustRecord({
			config: config({ base_branch: "origin/develop" }),
			command: "run",
			source: "validated",
			status: "passed",
			trusted: true,
			commit: "commit123",
			tree: "tree123",
		});

		expect(operationalChange.config_hash).toBe(base.config_hash);
		expect(gateAffectingChange.config_hash).not.toBe(base.config_hash);
	});
});
