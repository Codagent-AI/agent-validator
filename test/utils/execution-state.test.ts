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

describe.serial("Execution State Git Operations (real repository)", () => {
	let repoDir: string;
	let originalCwd: string;

	async function git(args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			childProcess.execFile("git", args, { cwd: repoDir }, (error, stdout) => {
				if (error) reject(error);
				else resolve(stdout.trim());
			});
		});
	}

	beforeEach(async () => {
		originalCwd = process.cwd();
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
		repoDir = await fs.mkdtemp(path.join(TEST_DIR, "repo-"));
		await git(["init", "-b", "main"]);
		await git(["config", "user.email", "test@example.com"]);
		await git(["config", "user.name", "Test User"]);
		await fs.writeFile(path.join(repoDir, "tracked.txt"), "base\n");
		await git(["add", "tracked.txt"]);
		await git(["commit", "-m", "base"]);
		process.chdir(repoDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		mock.restore();
	});

	it("fails with an actionable message when the Git index is locked", async () => {
		await fs.writeFile(path.join(repoDir, "tracked.txt"), "changed\n");
		await fs.writeFile(path.join(repoDir, "untracked.txt"), "new\n");
		await fs.writeFile(path.join(repoDir, ".git", "index.lock"), "");

		await expect(createWorkingTreeRef()).rejects.toThrow(
			"remove the stale .git/index.lock file",
		);
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
		const head = "head-sha";
		let calls: string[][];
		let failCommand: string | undefined;
		let failMessage: string;
		let untracked: string;
		let clean: boolean;
		let createLock: boolean;
		let input: string | undefined;
		let stdinErrorUnhandled: boolean;

		beforeEach(async () => {
			calls = [];
			failCommand = undefined;
			failMessage = "snapshot failed";
			untracked = " new file.txt \0";
			clean = false;
			createLock = false;
			input = undefined;
			stdinErrorUnhandled = false;
			await fs.writeFile(path.join(TEST_DIR, "index"), "user index");
			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) =>
					createMockSpawn(
						(args as string[])[0] === "status"
							? clean
								? ""
								: " M file\n"
							: (args as string[]).includes("--abbrev-ref")
								? "main\n"
								: `${head}\n`,
						0,
					) as ReturnType<typeof childProcess.spawn>,
			);
			execFileSpy = spyOn(childProcess, "execFile").mockImplementation(((
				_file: unknown,
				rawArgs: unknown,
				optionsOrCallback: unknown,
				callback?: unknown,
			) => {
				const args = rawArgs as string[];
				calls.push(args);
				const cb = (callback ?? optionsOrCallback) as (
					err: Error | null,
					stdout: string,
					stderr: string,
				) => void;
				setImmediate(async () => {
					if (args[0] === failCommand) {
						if (createLock)
							await fs.writeFile(path.join(TEST_DIR, "index.lock"), "");
						cb(new Error(failMessage), "", failMessage);
						return;
					}
					let output = "";
					if (args.includes("--git-path")) output = path.join(TEST_DIR, args[2]);
					else if (args.includes("--show-toplevel")) output = TEST_DIR;
					else if (args[0] === "rev-parse") output = head;
					else if (args[0] === "write-tree") output = "tree-sha";
					else if (args[0] === "ls-files") {
						output = untracked;
						const options = optionsOrCallback as childProcess.ExecFileOptions;
						if (Buffer.byteLength(output) > (options.maxBuffer ?? 1024 * 1024)) {
							cb(new Error("stdout maxBuffer length exceeded"), "", "");
							return;
						}
					} else if (args[0] === "commit-tree")
						output = args.includes("On main: validator-snapshot")
							? "snapshot-sha"
							: args.includes("index on main: validator-snapshot")
								? "index-sha"
								: "untracked-sha";
					cb(null, output, "");
				});
				const stdin = Object.assign(new EventEmitter(), {
					end: (value: string) => {
						input = value;
						if (failCommand === "update-index") {
							try {
								stdin.emit("error", new Error("write EPIPE"));
							} catch {
								stdinErrorUnhandled = true;
							}
						}
					},
				});
				return { stdin };
			}) as typeof childProcess.execFile);
		});

		it("builds three stash parents without stash push, stash pop or reset", async () => {
			expect(await createWorkingTreeRef()).toBe("snapshot-sha");
			expect(calls.map((args) => args[0])).toEqual([
				"rev-parse",
				"rev-parse",
				"rev-parse",
				"rev-parse",
				"write-tree",
				"commit-tree",
				"ls-files",
				"read-tree",
				"update-index",
				"write-tree",
				"commit-tree",
				"add",
				"write-tree",
				"commit-tree",
			]);
			expect(calls.at(-1)).toEqual([
				"commit-tree",
				"tree-sha",
				"-p",
				head,
				"-p",
				"index-sha",
				"-p",
				"untracked-sha",
				"-m",
				"On main: validator-snapshot",
			]);
			expect(input).toBe(untracked);
			expect(calls.some((args) => ["stash", "reset"].includes(args[0]))).toBe(
				false,
			);
			expect(await fs.readdir(TEST_DIR)).toEqual(["index"]);
			expect(await fs.readFile(path.join(TEST_DIR, "index"), "utf8")).toBe(
				"user index",
			);
			const options = execFileSpy.mock.calls.find(
				(call) => (call[1] as string[])[0] === "add",
			)?.[2] as childProcess.ExecFileOptions;
			expect(options.env?.GIT_INDEX_FILE).toContain("index.validator-");
			expect(options.cwd).toBe(TEST_DIR);
		});

		it("captures untracked path lists exceeding the default 1 MiB output buffer", async () => {
			untracked = "untracked-path.txt\0".repeat(65_536);
			expect(Buffer.byteLength(untracked)).toBeGreaterThan(1024 * 1024);
			expect(await createWorkingTreeRef()).toBe("snapshot-sha");
			expect(input).toBe(untracked);
		});

		it("handles a broken stdin pipe through the snapshot failure path", async () => {
			failCommand = "update-index";
			expect(await createWorkingTreeRef()).toBe(head);
			expect(stdinErrorUnhandled).toBe(false);
		});

		it("warns when snapshot failure falls back to HEAD", async () => {
			failCommand = "write-tree";
			const warning = spyOn(console, "error").mockImplementation(() => {});
			expect(await createWorkingTreeRef()).toBe(head);
			expect(warning).toHaveBeenCalledWith(
				expect.stringContaining("snapshot failed"),
			);
			expect(warning).toHaveBeenCalledWith(expect.stringContaining("HEAD"));
		});

		it("includes an empty untracked parent for tracked-only changes", async () => {
			untracked = "";
			expect(await createWorkingTreeRef()).toBe("snapshot-sha");
			expect(calls.some((args) => args[0] === "update-index")).toBe(false);
			expect(calls.at(-1)).toContain("untracked-sha");
		});

		it("returns HEAD without snapshot commands when there are no working-tree changes", async () => {
			clean = true;
			expect(await createWorkingTreeRef()).toBe(head);
			expect(execFileSpy).not.toHaveBeenCalled();
		});

		for (const command of ["write-tree", "update-index", "add", "commit-tree"]) {
			it(`falls back to HEAD and cleans temporary indexes when ${command} fails`, async () => {
				failCommand = command;
				expect(await createWorkingTreeRef()).toBe(head);
				expect(await fs.readdir(TEST_DIR)).toEqual(["index"]);
			});
		}

		it("does not report an index lock when no lock file exists", async () => {
			failCommand = "write-tree";
			failMessage = "Unable to create '.git/index.lock': File exists";
			expect(await createWorkingTreeRef()).toBe(head);
		});

		it("raises an actionable error if an index lock appears during snapshotting", async () => {
			failCommand = "write-tree";
			failMessage = "Unable to create '.git/index.lock': File exists";
			createLock = true;
			await expect(createWorkingTreeRef()).rejects.toThrow(
				"remove the stale .git/index.lock file",
			);
			expect((await fs.readdir(TEST_DIR)).sort()).toEqual([
				"index",
				"index.lock",
			]);
		});
	});

	describe("writeExecutionState", () => {
		it("creates state file with correct content", async () => {
			const mockBranch = "feature-branch";
			const mockCommit = "commit123456789012345678901234567890ab";

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) => {
					const argsArray = args as string[];
					if (argsArray.includes("--abbrev-ref")) {
						return createMockSpawn(`${mockBranch}\n`, 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					if (argsArray.includes("--porcelain")) {
						return createMockSpawn("", 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					// rev-parse HEAD
					return createMockSpawn(`${mockCommit}\n`, 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
			);

			await writeExecutionState(TEST_DIR);

			const content = await fs.readFile(
				path.join(TEST_DIR, ".execution_state"),
				"utf-8",
			);
			const state = JSON.parse(content);

			expect(state.branch).toBe(mockBranch);
			expect(state.commit).toBe(mockCommit);
			expect(state.working_tree_ref).toBe(mockCommit);
			expect(state).toHaveProperty("last_run_completed_at");
			expect(new Date(state.last_run_completed_at).toISOString()).toBe(
				state.last_run_completed_at,
			);
		});

		it("removes legacy .session_ref file", async () => {
			const sessionRefPath = path.join(TEST_DIR, ".session_ref");
			await fs.writeFile(sessionRefPath, "old-session-ref");

			spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
				(_cmd, args) => {
					const argsArray = args as string[];
					if (argsArray.includes("--porcelain")) {
						return createMockSpawn("", 0) as ReturnType<
							typeof childProcess.spawn
						>;
					}
					return createMockSpawn("mock-value\n", 0) as ReturnType<
						typeof childProcess.spawn
					>;
				},
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
