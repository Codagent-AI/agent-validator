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
	createWorkingTreeRef,
	deleteExecutionState,
	getCurrentBranch,
	getCurrentCommit,
	getExecutionStateFilename,
	getUnhealthyAdapters,
	gitObjectExists,
	isAdapterCoolingDown,
	isCommitInBranch,
	markAdapterHealthy,
	markAdapterUnhealthy,
	readExecutionState,
	resolveFixBase,
	type UnhealthyAdapter,
	writeExecutionState,
} from "../../src/utils/execution-state.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-execution-state");

// Helper to create a mock spawn process
function createMockSpawn(stdout: string, exitCode: number) {
	const mockProcess = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter & { setEncoding: (enc: string) => void };
		stderr: EventEmitter & { setEncoding: (enc: string) => void };
	};
	// setEncoding is a no-op in mocks: data is already emitted as string/buffer.
	mockProcess.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
	mockProcess.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });

	// Schedule the events to fire asynchronously
	setImmediate(() => {
		if (stdout) {
			mockProcess.stdout.emit("data", Buffer.from(stdout));
		}
		mockProcess.emit("close", exitCode);
	});

	return mockProcess;
}

describe("Execution State Utilities", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		mock.restore();
	});

	describe("getExecutionStateFilename", () => {
		it("returns the correct filename", () => {
			expect(getExecutionStateFilename()).toBe(".execution_state");
		});
	});

	describe("readExecutionState", () => {
		it("returns null when directory does not exist", async () => {
			const result = await readExecutionState(
				path.join(TEST_DIR, "nonexistent"),
			);
			expect(result).toBeNull();
		});

		it("returns null when state file does not exist", async () => {
			const result = await readExecutionState(TEST_DIR);
			expect(result).toBeNull();
		});

		it("returns parsed state when file exists", async () => {
			const state = {
				last_run_completed_at: "2026-01-25T12:00:00.000Z",
				branch: "feature-branch",
				commit: "abc123def456",
			};
			await fs.writeFile(
				path.join(TEST_DIR, ".execution_state"),
				JSON.stringify(state),
			);

			const result = await readExecutionState(TEST_DIR);
			expect(result).toEqual(state);
		});

		it("returns state with working_tree_ref when present", async () => {
			const state = {
				last_run_completed_at: "2026-01-25T12:00:00.000Z",
				branch: "feature-branch",
				commit: "abc123def456",
				working_tree_ref: "stash123sha456",
			};
			await fs.writeFile(
				path.join(TEST_DIR, ".execution_state"),
				JSON.stringify(state),
			);

			const result = await readExecutionState(TEST_DIR);
			expect(result).toEqual(state);
		});

		it("returns null on invalid JSON", async () => {
			await fs.writeFile(
				path.join(TEST_DIR, ".execution_state"),
				"invalid json{",
			);

			const result = await readExecutionState(TEST_DIR);
			expect(result).toBeNull();
		});

		it("returns null when required fields are missing", async () => {
			await fs.writeFile(
				path.join(TEST_DIR, ".execution_state"),
				JSON.stringify({ branch: "test" }), // missing last_run_completed_at and commit
			);

			const result = await readExecutionState(TEST_DIR);
			expect(result).toBeNull();
		});
	});

	describe("deleteExecutionState", () => {
		it("removes execution state file when it exists", async () => {
			const statePath = path.join(TEST_DIR, ".execution_state");
			await fs.writeFile(statePath, JSON.stringify({ branch: "test" }));

			const statBefore = await fs.stat(statePath);
			expect(statBefore.isFile()).toBe(true);

			await deleteExecutionState(TEST_DIR);

			try {
				await fs.stat(statePath);
				expect(true).toBe(false); // Should not reach
			} catch (e: unknown) {
				expect((e as { code: string }).code).toBe("ENOENT");
			}
		});

		it("does not throw when file does not exist", async () => {
			await deleteExecutionState(path.join(TEST_DIR, "nonexistent"));
		});
	});
});

describe("Execution State Git Operations (mocked)", () => {
	let spawnSpy: ReturnType<typeof spyOn>;
	let execFileSpy: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		mock.restore();
	});

	describe("getCurrentBranch", () => {
		it("returns current git branch name", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn("main\n", 0) as ReturnType<
					typeof childProcess.spawn
				>;
			});

			const branch = await getCurrentBranch();
			expect(branch).toBe("main");
			expect(spawnSpy).toHaveBeenCalledWith(
				"git",
				["rev-parse", "--abbrev-ref", "HEAD"],
				expect.any(Object),
			);
		});

		it("rejects when git command fails", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn("", 128) as ReturnType<
					typeof childProcess.spawn
				>;
			});

			await expect(getCurrentBranch()).rejects.toThrow(
				"git rev-parse --abbrev-ref HEAD failed with code 128",
			);
		});
	});

	describe("getCurrentCommit", () => {
		it("returns current HEAD commit SHA", async () => {
			const mockSha = "abc123def456789012345678901234567890abcd";
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn(`${mockSha}\n`, 0) as ReturnType<
					typeof childProcess.spawn
				>;
			});

			const commit = await getCurrentCommit();
			expect(commit).toBe(mockSha);
			expect(spawnSpy).toHaveBeenCalledWith(
				"git",
				["rev-parse", "HEAD"],
				expect.any(Object),
			);
		});

		it("rejects when git command fails", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn("", 128) as ReturnType<
					typeof childProcess.spawn
				>;
			});

			await expect(getCurrentCommit()).rejects.toThrow(
				"git rev-parse HEAD failed with code 128",
			);
		});
	});

	describe("isCommitInBranch", () => {
		it("returns true when commit is ancestor of branch", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn("", 0) as ReturnType<typeof childProcess.spawn>;
			});

			const result = await isCommitInBranch("abc123", "main");
			expect(result).toBe(true);
			expect(spawnSpy).toHaveBeenCalledWith(
				"git",
				["merge-base", "--is-ancestor", "abc123", "main"],
				expect.any(Object),
			);
		});

		it("returns false when commit is not ancestor", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn("", 1) as ReturnType<typeof childProcess.spawn>;
			});

			const result = await isCommitInBranch("abc123", "main");
			expect(result).toBe(false);
		});

		it("returns false on error", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				const mockProcess = new EventEmitter() as EventEmitter & {
					stdout: EventEmitter & { setEncoding: (enc: string) => void };
					stderr: EventEmitter & { setEncoding: (enc: string) => void };
				};
				mockProcess.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
				mockProcess.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
				setImmediate(() => {
					mockProcess.emit("error", new Error("spawn failed"));
				});
				return mockProcess as ReturnType<typeof childProcess.spawn>;
			});

			const result = await isCommitInBranch("abc123", "main");
			expect(result).toBe(false);
		});
	});

	describe("gitObjectExists", () => {
		it("returns true when object exists", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn("commit\n", 0) as ReturnType<
					typeof childProcess.spawn
				>;
			});

			const exists = await gitObjectExists("abc123");
			expect(exists).toBe(true);
			expect(spawnSpy).toHaveBeenCalledWith(
				"git",
				["cat-file", "-t", "abc123"],
				expect.any(Object),
			);
		});

		it("returns false when object does not exist", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn("", 128) as ReturnType<
					typeof childProcess.spawn
				>;
			});

			const exists = await gitObjectExists("nonexistent");
			expect(exists).toBe(false);
		});

		it("returns false on error", async () => {
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				const mockProcess = new EventEmitter() as EventEmitter & {
					stdout: EventEmitter & { setEncoding: (enc: string) => void };
					stderr: EventEmitter & { setEncoding: (enc: string) => void };
				};
				mockProcess.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
				mockProcess.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
				setImmediate(() => {
					mockProcess.emit("error", new Error("spawn failed"));
				});
				return mockProcess as ReturnType<typeof childProcess.spawn>;
			});

			const exists = await gitObjectExists("abc123");
			expect(exists).toBe(false);
		});
	});

	describe("createWorkingTreeRef", () => {
		// Helper: mock execFile callback-style
		function mockExecFile(
			handler: (
				args: string[],
				callback: (
					err: null | Error,
					stdout: string,
					stderr: string,
				) => void,
			) => void,
		) {
			return spyOn(childProcess, "execFile").mockImplementation(
				((_file: unknown, args: unknown, callback: unknown) => {
					const cb = callback as (
						err: null | Error,
						stdout: string,
						stderr: string,
					) => void;
					handler(args as string[], cb);
					return {} as ReturnType<typeof childProcess.execFile>;
				}) as typeof childProcess.execFile,
			);
		}

		it("returns stash SHA when working tree is dirty", async () => {
			const stashSha = "stash123456789012345678901234567890abcd";

			// hasWorkingTreeChanges → dirty
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() =>
				createMockSpawn("M src/foo.ts\n", 0) as ReturnType<
					typeof childProcess.spawn
				>,
			);

			// pre-push rev-parse --verify → no pre-existing stash (reject)
			// stash push → ok, post-push rev-parse stash@{0} → stashSha, stash pop → ok
			execFileSpy = mockExecFile((args, cb) => {
				setImmediate(() => {
					if (args.includes("--verify")) {
						cb(new Error("no stash"), "", "");
					} else if (args.includes("rev-parse")) {
						cb(null, `${stashSha}\n`, "");
					} else {
						cb(null, "", "");
					}
				});
			});

			const ref = await createWorkingTreeRef();
			expect(ref).toBe(stashSha);
		});

		it("returns HEAD SHA when stash push is a no-op", async () => {
			const headSha = "head1234567890123456789012345678901234ab";
			const prevStash = "prev567890123456789012345678901234567890";

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) => {
					const cmdArgs = args as string[];
					if (cmdArgs.includes("--porcelain")) {
						// dirty tree → proceeds to stash
						return createMockSpawn("M src/foo.ts\n", 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// getCurrentCommit: rev-parse HEAD
					return createMockSpawn(`${headSha}\n`, 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			// pre-push rev-parse --verify → prevStash (existing stash)
			// push → ok (exit 0, but no-op)
			// post-push rev-parse stash@{0} → still prevStash (no new entry)
			execFileSpy = mockExecFile((args, cb) => {
				setImmediate(() => {
					if (args.includes("rev-parse")) {
						cb(null, `${prevStash}\n`, "");
					} else {
						cb(null, "", "");
					}
				});
			});

			const ref = await createWorkingTreeRef();
			expect(ref).toBe(headSha);
		});

		it("returns HEAD SHA silently when push is a no-op with no pre-existing stash", async () => {
			const headSha = "head1234567890123456789012345678901234ab";

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) => {
					const cmdArgs = args as string[];
					if (cmdArgs.includes("--porcelain")) {
						// dirty tree → proceeds to stash
						return createMockSpawn("M src/foo.ts\n", 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// getCurrentCommit: rev-parse HEAD
					return createMockSpawn(`${headSha}\n`, 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			const errorSpy = spyOn(console, "error").mockImplementation(() => {});

			// pre-push rev-parse --verify → fail (no pre-existing stash → prevStashSha = null)
			// push → ok (no-op, git decides nothing to stash)
			// post-push rev-parse stash@{0} → fail (no stash created)
			execFileSpy = mockExecFile((args, cb) => {
				setImmediate(() => {
					if (args.includes("push")) {
						cb(null, "", "");
					} else {
						// both --verify and post-push rev-parse fail
						cb(new Error("no stash"), "", "");
					}
				});
			});

			const ref = await createWorkingTreeRef();
			expect(ref).toBe(headSha);
			// No panic warning should be emitted
			expect(errorSpy).not.toHaveBeenCalled();
			errorSpy.mockRestore();
		});

		it("returns HEAD SHA and warns when post-push rev-parse fails with pre-existing stash", async () => {
			const headSha = "head1234567890123456789012345678901234ab";
			const prevStash = "prev567890123456789012345678901234567890";

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) => {
					const cmdArgs = args as string[];
					if (cmdArgs.includes("--porcelain")) {
						return createMockSpawn("M src/foo.ts\n", 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					return createMockSpawn(`${headSha}\n`, 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			const errorSpy = spyOn(console, "error").mockImplementation(() => {});

			// pre-push rev-parse --verify → prevStash (pre-existing stash)
			// push → ok
			// post-push rev-parse stash@{0} → fails (uncertain state)
			execFileSpy = mockExecFile((args, cb) => {
				setImmediate(() => {
					if (args.includes("--verify")) {
						cb(null, `${prevStash}\n`, "");
					} else if (args.includes("push")) {
						cb(null, "", "");
					} else {
						// post-push rev-parse fails
						cb(new Error("no such ref"), "", "");
					}
				});
			});

			const ref = await createWorkingTreeRef();
			expect(ref).toBe(headSha);
			// Should warn (not destructively pop) in uncertain state
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("leaving stash untouched"),
			);
			errorSpy.mockRestore();
		});

		it("returns HEAD SHA when working tree is clean", async () => {
			const headSha = "head1234567890123456789012345678901234ab";

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) => {
					const cmdArgs = args as string[];
					if (cmdArgs.includes("--porcelain")) {
						// clean tree
						return createMockSpawn("", 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// getCurrentCommit: rev-parse HEAD
					return createMockSpawn(`${headSha}\n`, 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			const ref = await createWorkingTreeRef();
			expect(ref).toBe(headSha);
		});

		it("falls back to HEAD SHA when stash push fails", async () => {
			const headSha = "head1234567890123456789012345678901234ab";

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) => {
					const cmdArgs = args as string[];
					if (cmdArgs.includes("--porcelain")) {
						return createMockSpawn("M src/foo.ts\n", 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					return createMockSpawn(`${headSha}\n`, 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			execFileSpy = mockExecFile((_args, cb) => {
				setImmediate(() => cb(new Error("stash push failed"), "", ""));
			});

			const ref = await createWorkingTreeRef();
			expect(ref).toBe(headSha);
		});

		it("returns stash SHA and warns when stash pop fails", async () => {
			const stashSha = "stash123456789012345678901234567890abcd";

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() =>
				createMockSpawn("M src/foo.ts\n", 0) as ReturnType<
					typeof childProcess.spawn
				>,
			);

			const errorSpy = spyOn(console, "error").mockImplementation(() => {});

			execFileSpy = mockExecFile((args, cb) => {
				setImmediate(() => {
					if (args.includes("pop")) {
						cb(new Error("stash pop failed"), "", "");
					} else if (args.includes("--verify")) {
						// No pre-existing stash → prevStashSha = null
						cb(new Error("no stash"), "", "");
					} else if (args.includes("rev-parse")) {
						cb(null, `${stashSha}\n`, "");
					} else {
						cb(null, "", "");
					}
				});
			});

			const ref = await createWorkingTreeRef();
			expect(ref).toBe(stashSha);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("stash pop"),
			);
			errorSpy.mockRestore();
		});
	});

	describe("writeExecutionState", () => {
		it("creates state file with correct content", async () => {
			const mockBranch = "feature-branch";
			const mockCommit = "commit123456789012345678901234567890ab";
			const mockStash = "stash1234567890123456789012345678901234";

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) => {
					const argsArray = args as string[];
					if (argsArray.includes("--abbrev-ref")) {
						return createMockSpawn(`${mockBranch}\n`, 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					if (argsArray.includes("--porcelain")) {
						// dirty tree so createWorkingTreeRef proceeds to stash
						return createMockSpawn("M src/foo.ts\n", 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// rev-parse HEAD
					return createMockSpawn(`${mockCommit}\n`, 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			execFileSpy = spyOn(childProcess, "execFile").mockImplementation(
				((_file: unknown, args: unknown, callback: unknown) => {
					const cmdArgs = args as string[];
					const cb = callback as (
						err: null | Error,
						stdout: string,
						stderr: string,
					) => void;
					setImmediate(() => {
						if (cmdArgs.includes("--verify")) {
							// No pre-existing stash → prevStashSha = null
							cb(new Error("no stash"), "", "");
						} else if (cmdArgs.includes("rev-parse")) {
							cb(null, `${mockStash}\n`, "");
						} else {
							cb(null, "", "");
						}
					});
					return {} as ReturnType<typeof childProcess.execFile>;
				}) as typeof childProcess.execFile,
			);

			await writeExecutionState(TEST_DIR);

			const content = await fs.readFile(
				path.join(TEST_DIR, ".execution_state"),
				"utf-8",
			);
			const state = JSON.parse(content);

			expect(state.branch).toBe(mockBranch);
			expect(state.commit).toBe(mockCommit);
			expect(state.working_tree_ref).toBe(mockStash);
			expect(state).toHaveProperty("last_run_completed_at");
			expect(new Date(state.last_run_completed_at).toISOString()).toBe(
				state.last_run_completed_at,
			);
		});

		it("removes legacy .session_ref file", async () => {
			const sessionRefPath = path.join(TEST_DIR, ".session_ref");
			await fs.writeFile(sessionRefPath, "old-session-ref");

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
				return createMockSpawn("mock-value\n", 0) as ReturnType<
					typeof childProcess.spawn
				>;
			});

			execFileSpy = spyOn(childProcess, "execFile").mockImplementation(
				((_file: unknown, args: unknown, callback: unknown) => {
					const cmdArgs = args as string[];
					const cb = callback as (
						err: null | Error,
						stdout: string,
						stderr: string,
					) => void;
					setImmediate(() => {
						if (cmdArgs.includes("--verify")) {
							// No pre-existing stash → prevStashSha = null
							cb(new Error("no stash"), "", "");
						} else {
							cb(null, "mock-stash-sha\n", "");
						}
					});
					return {} as ReturnType<typeof childProcess.execFile>;
				}) as typeof childProcess.execFile,
			);

			await writeExecutionState(TEST_DIR);

			// .session_ref should be deleted
			try {
				await fs.stat(sessionRefPath);
				expect(true).toBe(false); // Should not reach
			} catch (e: unknown) {
				expect((e as { code: string }).code).toBe("ENOENT");
			}
		});
	});

	describe("isAdapterCoolingDown", () => {
		it("returns true when marked_at is recent", () => {
			const entry: UnhealthyAdapter = {
				marked_at: new Date().toISOString(),
				reason: "Usage limit exceeded",
			};
			expect(isAdapterCoolingDown(entry)).toBe(true);
		});

		it("returns false when marked_at is over 1 hour ago", () => {
			const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
			const entry: UnhealthyAdapter = {
				marked_at: twoHoursAgo.toISOString(),
				reason: "Usage limit exceeded",
			};
			expect(isAdapterCoolingDown(entry)).toBe(false);
		});

		it("returns false for invalid timestamp", () => {
			const entry: UnhealthyAdapter = {
				marked_at: "invalid-date",
				reason: "Usage limit exceeded",
			};
			expect(isAdapterCoolingDown(entry)).toBe(false);
		});
	});

	// Helper to write a state file with optional unhealthy adapters
	async function writeTestState(
		dir: string,
		adapters?: Record<string, { marked_at: string; reason: string }>,
	) {
		const state: Record<string, unknown> = {
			last_run_completed_at: new Date().toISOString(),
			branch: "main",
			commit: "abc123def456",
		};
		if (adapters) state.unhealthy_adapters = adapters;
		await fs.writeFile(
			path.join(dir, ".execution_state"),
			JSON.stringify(state),
		);
	}

	async function readTestState(dir: string) {
		const content = await fs.readFile(
			path.join(dir, ".execution_state"),
			"utf-8",
		);
		return JSON.parse(content);
	}

	const USAGE_LIMIT = "Usage limit exceeded";
	const recentMark = () => ({
		marked_at: new Date().toISOString(),
		reason: USAGE_LIMIT,
	});

	describe("getUnhealthyAdapters", () => {
		it("returns empty object when no state file exists", async () => {
			const result = await getUnhealthyAdapters(
				path.join(TEST_DIR, "nonexistent"),
			);
			expect(result).toEqual({});
		});

		it("returns empty object when state has no unhealthy_adapters", async () => {
			await writeTestState(TEST_DIR);
			expect(await getUnhealthyAdapters(TEST_DIR)).toEqual({});
		});

		it("returns unhealthy adapters when present", async () => {
			await writeTestState(TEST_DIR, { claude: recentMark() });
			const result = await getUnhealthyAdapters(TEST_DIR);
			expect(result).toHaveProperty("claude");
			expect(result.claude?.reason).toBe(USAGE_LIMIT);
		});
	});

	describe("markAdapterUnhealthy", () => {
		it("creates state file with unhealthy adapter when no file exists", async () => {
			const dir = path.join(TEST_DIR, "mark-unhealthy");
			await markAdapterUnhealthy(dir, "claude", USAGE_LIMIT);
			const state = await readTestState(dir);
			expect(state.unhealthy_adapters.claude.reason).toBe(USAGE_LIMIT);
			expect(state.unhealthy_adapters.claude.marked_at).toBeDefined();
		});

		it("preserves existing state when adding unhealthy adapter", async () => {
			await writeTestState(TEST_DIR);
			await markAdapterUnhealthy(TEST_DIR, "claude", USAGE_LIMIT);
			const updated = await readTestState(TEST_DIR);
			expect(updated.branch).toBe("main");
			expect(updated.unhealthy_adapters.claude.reason).toBe(USAGE_LIMIT);
		});
	});

	describe("markAdapterHealthy", () => {
		it("removes adapter from unhealthy list", async () => {
			await writeTestState(TEST_DIR, {
				claude: recentMark(),
				codex: recentMark(),
			});
			await markAdapterHealthy(TEST_DIR, "claude");
			const updated = await readTestState(TEST_DIR);
			expect(updated.unhealthy_adapters).not.toHaveProperty("claude");
			expect(updated.unhealthy_adapters).toHaveProperty("codex");
		});

		it("removes unhealthy_adapters key when last adapter removed", async () => {
			await writeTestState(TEST_DIR, { claude: recentMark() });
			await markAdapterHealthy(TEST_DIR, "claude");
			const updated = await readTestState(TEST_DIR);
			expect(updated.unhealthy_adapters).toBeUndefined();
		});

		it("does nothing when no state file exists", async () => {
			await markAdapterHealthy(path.join(TEST_DIR, "nonexistent"), "claude");
		});
	});

	describe("readExecutionState with unhealthy_adapters", () => {
		it("returns state with unhealthy_adapters when present", async () => {
			await writeTestState(TEST_DIR, { claude: recentMark() });
			const result = await readExecutionState(TEST_DIR);
			expect(result?.unhealthy_adapters?.claude?.reason).toBe(USAGE_LIMIT);
		});

		it("returns state without unhealthy_adapters for older files", async () => {
			await writeTestState(TEST_DIR);
			const result = await readExecutionState(TEST_DIR);
			expect(result?.unhealthy_adapters).toBeUndefined();
		});
	});

	describe("resolveFixBase", () => {
		const COMMIT = "abc123def456789012345678901234567890abcd";
		const STASH_REF = "stash123456789012345678901234567890ab";

		function mergedState(overrides?: Partial<{ working_tree_ref: string }>) {
			return {
				last_run_completed_at: new Date().toISOString(),
				branch: "feature",
				commit: COMMIT,
				...overrides,
			};
		}

		/** Mock spawn where --is-ancestor exits with `ancestorCode` and cat-file exits with `catFileCode` */
		function mockAncestorAndCatFile(ancestorCode: number, catFileCode: number) {
			return spyOn(childProcess, "spawn").mockImplementation((_cmd, args) => {
				const argsArray = args as string[];
				if (argsArray.includes("--is-ancestor")) {
					return createMockSpawn("", ancestorCode) as ReturnType<
						typeof childProcess.spawn
					>;
				}
				return createMockSpawn("", catFileCode) as ReturnType<
					typeof childProcess.spawn
				>;
			});
		}

		it("returns working_tree_ref when commit merged but working_tree_ref is valid", async () => {
			spawnSpy = mockAncestorAndCatFile(0, 0);
			const state = mergedState({ working_tree_ref: STASH_REF });
			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBe(STASH_REF);
			expect(result.warning).toContain("Commit merged into base branch");
		});

		it("returns null when commit merged and working_tree_ref is gc'd", async () => {
			spawnSpy = mockAncestorAndCatFile(0, 128);
			const state = mergedState({ working_tree_ref: STASH_REF });
			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBeNull();
			expect(result.warning).toBeUndefined();
		});

		it("returns null when commit merged and no working_tree_ref", async () => {
			spawnSpy = mockAncestorAndCatFile(0, 0);
			const state = mergedState();
			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBeNull();
			expect(result.warning).toBeUndefined();
		});

		it("returns working_tree_ref when valid and commit not merged", async () => {
			let callCount = 0;
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(cmd, args) => {
					callCount++;
					const argsArray = args as string[];
					if (argsArray.includes("--is-ancestor")) {
						// Not merged
						return createMockSpawn("", 1) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// cat-file: object exists
					return createMockSpawn("commit\n", 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "feature",
				commit: "abc123def456789012345678901234567890abcd",
				working_tree_ref: "stash123456789012345678901234567890ab",
			};

			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBe(state.working_tree_ref);
			expect(result.warning).toBeUndefined();
		});

		it("falls back to commit when working_tree_ref is gc'd", async () => {
			let callCount = 0;
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(cmd, args) => {
					callCount++;
					const argsArray = args as string[];
					if (argsArray.includes("--is-ancestor")) {
						// Not merged
						return createMockSpawn("", 1) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					if (callCount === 2) {
						// First cat-file (working_tree_ref): not found
						return createMockSpawn("", 128) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// Second cat-file (commit): exists
					return createMockSpawn("commit\n", 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "feature",
				commit: "abc123def456789012345678901234567890abcd",
				working_tree_ref: "stash123456789012345678901234567890ab",
			};

			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBe(state.commit);
			expect(result.warning).toContain("garbage collected");
		});

		it("returns null when both refs are invalid", async () => {
			let callCount = 0;
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(cmd, args) => {
					callCount++;
					const argsArray = args as string[];
					if (argsArray.includes("--is-ancestor")) {
						// Not merged
						return createMockSpawn("", 1) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// All cat-file calls: not found
					return createMockSpawn("", 128) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "feature",
				commit: "abc123def456789012345678901234567890abcd",
				working_tree_ref: "stash123456789012345678901234567890ab",
			};

			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBeNull();
		});

		it("handles missing working_tree_ref", async () => {
			let callCount = 0;
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(cmd, args) => {
					callCount++;
					const argsArray = args as string[];
					if (argsArray.includes("--is-ancestor")) {
						// Not merged
						return createMockSpawn("", 1) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// cat-file (commit): exists
					return createMockSpawn("commit\n", 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "feature",
				commit: "abc123def456789012345678901234567890abcd",
				// No working_tree_ref
			};

			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBe(state.commit);
			expect(result.warning).toContain("garbage collected");
		});
	});
});
