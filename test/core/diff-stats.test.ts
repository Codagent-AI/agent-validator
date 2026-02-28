import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	computeDiffStats,
	type DiffStats,
	setExecFileAsync,
} from "../../src/core/diff-stats.js";

// Mock exec function
const mockExec = mock();

// Helper to create mock git responses
const createMockOutput = (stdout: string) =>
	Promise.resolve({ stdout, stderr: "" });

describe("computeDiffStats", () => {
	beforeEach(() => {
		// Inject mock
		setExecFileAsync(mockExec);
		mockExec.mockClear();
		mockExec.mockImplementation(() => createMockOutput(""));

		// Clear CI environment variables
		delete process.env.CI;
		delete process.env.GITHUB_ACTIONS;
		delete process.env.GITHUB_SHA;
	});

	describe("parseNumstat", () => {
		it("returns zero counts for empty diff", async () => {
			mockExec.mockResolvedValue(createMockOutput(""));
			const result = await computeDiffStats("HEAD", { commit: "HEAD" });
			expect(result.linesAdded).toBe(0);
			expect(result.linesRemoved).toBe(0);
		});
	});

	describe("parseNameStatus", () => {
		it("returns proper structure with file counts", async () => {
			// Mock uncommitted diffs
			mockExec.mockImplementation((file, args) => {
				const argsArr = args as string[];
				if (argsArr.includes("--cached")) return createMockOutput("");
				if (argsArr.includes("--numstat")) return createMockOutput("");
				if (argsArr.includes("ls-files")) return createMockOutput("");
				// name-status
				return createMockOutput("M\tfile1.ts\nA\tfile2.ts\nD\tfile3.ts");
			});

			const result = await computeDiffStats("origin/main", {
				uncommitted: true,
			});

			expect(result.total).toBe(3);
			expect(result.newFiles).toBe(1);
			expect(result.modifiedFiles).toBe(1);
			expect(result.deletedFiles).toBe(1);
			expect(result.baseRef).toBe("uncommitted");
		});
	});

	describe("DiffStats interface", () => {
		it("has all required fields", () => {
			const stats: DiffStats = {
				baseRef: "origin/main",
				total: 10,
				newFiles: 3,
				modifiedFiles: 5,
				deletedFiles: 2,
				linesAdded: 100,
				linesRemoved: 50,
			};

			expect(stats.baseRef).toBe("origin/main");
			expect(stats.total).toBe(10);
			expect(stats.newFiles).toBe(3);
			expect(stats.modifiedFiles).toBe(5);
			expect(stats.deletedFiles).toBe(2);
			expect(stats.linesAdded).toBe(100);
			expect(stats.linesRemoved).toBe(50);
		});
	});

	describe("uncommitted mode", () => {
		it("returns uncommitted as baseRef", async () => {
			mockExec.mockImplementation(() => createMockOutput(""));
			const result = await computeDiffStats("origin/main", {
				uncommitted: true,
			});
			expect(result.baseRef).toBe("uncommitted");
		});

		it("returns numeric values for all counts", async () => {
			mockExec.mockImplementation(() => createMockOutput(""));
			const result = await computeDiffStats("origin/main", {
				uncommitted: true,
			});
			expect(typeof result.total).toBe("number");
			expect(result.total).toBe(0);
		});
	});

	describe("commit mode", () => {
		it("uses commit ref for diff", async () => {
			const commitSha = "abc1234567890abcdef1234567890abcdef12";

			// Mock successful git execution
			mockExec.mockImplementation((file, args) => {
				const argsArr = args as string[];
				// verify args contain the commit range
				if (argsArr.some((arg) => arg.includes(commitSha))) {
					return createMockOutput("");
				}
				return createMockOutput("");
			});

			const result = await computeDiffStats("origin/main", {
				commit: commitSha,
			});

			// baseRef should be the parent of the commit (commit^)
			expect(result.baseRef).toBe(`${commitSha}^`);
		});
	});

	describe("local development mode", () => {
		it("uses baseBranch for diff", async () => {
			mockExec.mockImplementation(() => createMockOutput(""));
			const result = await computeDiffStats("origin/main", {});
			expect(result.baseRef).toBe("origin/main");

			// Should call git diff baseBranch...HEAD
			expect(mockExec).toHaveBeenCalledWith(
				"git",
				expect.arrayContaining(["origin/main...HEAD"]),
				expect.anything(),
			);
		});
	});

	describe("CI mode", () => {
		it("uses baseBranch when in CI", async () => {
			process.env.CI = "true";
			mockExec.mockImplementation(() => createMockOutput(""));

			const result = await computeDiffStats("origin/main", {});
			expect(result.baseRef).toBe("origin/main");

			// Should call git diff baseBranch...HEAD (default fallback for no SHA) or similar
			// In CI mode w/o SHA, calls baseBranch...HEAD
			expect(mockExec).toHaveBeenCalled();
		});

		it("uses GITHUB_SHA when available", async () => {
			process.env.GITHUB_ACTIONS = "true";
			process.env.GITHUB_SHA = "abc1234567890abcdef1234567890abcdef12";

			mockExec.mockImplementation(() => createMockOutput(""));

			const result = await computeDiffStats("origin/main", {});
			// If successful, uses baseBranch
			// The logic: computeCIDiffStats uses baseBranch...headRef
			expect(result.baseRef).toBe("origin/main");

			expect(mockExec).toHaveBeenCalledWith(
				"git",
				expect.arrayContaining([`origin/main...${process.env.GITHUB_SHA}`]),
				expect.anything(),
			);
		});
	});

	describe("error handling", () => {
		it("returns empty stats on git error for commit mode", async () => {
			// Simulate error
			mockExec.mockRejectedValue(new Error("Git error"));

			const result = await computeDiffStats("origin/main", {
				commit: "invalid-sha",
			});

			// Should return the commit ref but with zero counts
			// Actually implementation falls back to --root, if that fails too, return empty
			expect(result.total).toBe(0);
			expect(result.newFiles).toBe(0);
		});
	});

	describe("binary files", () => {
		it("handles binary files gracefully (shown as - in numstat)", async () => {
			mockExec.mockImplementation((file, args) => {
				const argsArr = args as string[];
				if (argsArr.includes("--cached")) return createMockOutput("");
				if (argsArr.includes("--numstat")) {
					return createMockOutput("-\t-\tbinary.png\n10\t5\ttext.txt");
				}
				if (argsArr.includes("--name-status")) {
					return createMockOutput("A\tbinary.png\nM\ttext.txt");
				}
				return createMockOutput("");
			});

			const result = await computeDiffStats("origin/main", {
				uncommitted: true,
			});

			expect(result.linesAdded).toBe(10); // binary ignored
			expect(result.linesRemoved).toBe(5);
			expect(result.total).toBe(2);
		});
	});

	describe("fixBase mode", () => {
		it("uses fixBase ref for diff when provided", async () => {
			const headRef = "HEAD";
			mockExec.mockImplementation(() => createMockOutput(""));

			const result = await computeDiffStats("origin/main", {
				fixBase: headRef,
			});

			expect(result.baseRef).toBe(headRef);
		});

		it("returns only changes since fixBase, not all uncommitted changes", async () => {
			// Mock logic:
			// ls-files returns "file1"
			// ls-tree returns "file1" (so no new untracked)
			mockExec.mockImplementation((file, args) => {
				const argsArr = args as string[];
				if (argsArr.includes("ls-files")) return createMockOutput("file1");
				if (argsArr.includes("ls-tree")) return createMockOutput("file1");
				return createMockOutput("");
			});

			const result = await computeDiffStats("origin/main", {
				fixBase: "HEAD",
			});

			expect(result.baseRef).toBe("HEAD");
			expect(result.newFiles).toBe(0);
		});

		it("handles untracked files correctly against fixBase", async () => {
			// Mock: existing untracked "newfile" that wasn't in fixBase
			mockExec.mockImplementation((file, args) => {
				const argsArr = args as string[];
				if (argsArr.includes("ls-files")) return createMockOutput("newfile");
				if (argsArr.includes("ls-tree")) return createMockOutput(""); // empty tree
				if (argsArr.includes("--name-status")) return createMockOutput(""); // no tracked changes
				return createMockOutput("");
			});

			const result = await computeDiffStats("origin/main", {
				fixBase: "HEAD",
			});

			// Should include newFiles count (untacked files)
			expect(result.newFiles).toBe(1);
			expect(result.total).toBe(1);
		});

		it("returns empty stats for invalid fixBase ref", async () => {
			// Simulate error
			mockExec.mockRejectedValue(new Error("Git error"));

			const result = await computeDiffStats("origin/main", {
				fixBase: "invalid-ref",
			});

			expect(result.baseRef).toBe("invalid-ref");
			expect(result.total).toBe(0);
			expect(result.newFiles).toBe(0);
		});

		it("prioritizes fixBase over uncommitted option", async () => {
			const headRef = "HEAD";
			mockExec.mockImplementation(() => createMockOutput(""));

			const result = await computeDiffStats("origin/main", {
				fixBase: headRef,
				uncommitted: true,
			});

			expect(result.baseRef).toBe(headRef);
		});

		it("excludes unchanged untracked files from stash ^3 parent", async () => {
			const stashSha = "abc123";
			mockExec.mockImplementation((_file: string, args: string[]) => {
				// Current untracked files
				if (args.includes("ls-files")) return createMockOutput("file1.md");
				// Main tree (tracked) — empty, file was untracked
				if (args.includes("ls-tree") && args.includes(stashSha))
					return createMockOutput("");
				// Stash ^3 tree (untracked files captured by stash)
				if (args.includes("ls-tree") && args.includes(`${stashSha}^3`))
					return createMockOutput("file1.md");
				// Hash comparison: same hash = unchanged
				if (args.includes("rev-parse")) return createMockOutput("deadbeef");
				if (args.includes("hash-object")) return createMockOutput("deadbeef");
				return createMockOutput("");
			});

			const result = await computeDiffStats("origin/main", {
				fixBase: stashSha,
			});

			// File is unchanged, should be excluded entirely
			expect(result.newFiles).toBe(0);
			expect(result.modifiedFiles).toBe(0);
			expect(result.total).toBe(0);
		});

		it("counts changed stash untracked files as modified, not new", async () => {
			const stashSha = "abc123";
			mockExec.mockImplementation((_file: string, args: string[]) => {
				if (args.includes("ls-files")) return createMockOutput("file1.md");
				if (args.includes("ls-tree") && args.includes(stashSha))
					return createMockOutput("");
				if (args.includes("ls-tree") && args.includes(`${stashSha}^3`))
					return createMockOutput("file1.md");
				// Hash comparison: different hash = changed
				if (args.includes("rev-parse")) return createMockOutput("oldhash");
				if (args.includes("hash-object")) return createMockOutput("newhash");
				return createMockOutput("");
			});

			const result = await computeDiffStats("origin/main", {
				fixBase: stashSha,
			});

			// Changed file should be counted as modified, not new
			expect(result.newFiles).toBe(0);
			expect(result.modifiedFiles).toBe(1);
			expect(result.total).toBe(1);
		});

		it("handles mix of new and known untracked files from stash", async () => {
			const stashSha = "abc123";
			mockExec.mockImplementation((_file: string, args: string[]) => {
				if (args.includes("ls-files"))
					return createMockOutput("known.md\nnew.md");
				if (args.includes("ls-tree") && args.includes(stashSha))
					return createMockOutput("");
				if (args.includes("ls-tree") && args.includes(`${stashSha}^3`))
					return createMockOutput("known.md");
				// Hash comparison for known.md: changed
				if (args.includes("rev-parse")) return createMockOutput("old");
				if (args.includes("hash-object")) return createMockOutput("new");
				return createMockOutput("");
			});

			const result = await computeDiffStats("origin/main", {
				fixBase: stashSha,
			});

			// new.md is truly new, known.md is modified
			expect(result.newFiles).toBe(1);
			expect(result.modifiedFiles).toBe(1);
			expect(result.total).toBe(2);
		});

		it("falls back gracefully when stash ^3 does not exist", async () => {
			const commitSha = "abc123";
			mockExec.mockImplementation((_file: string, args: string[]) => {
				if (args.includes("ls-files"))
					return createMockOutput("file1.md");
				// Main tree returns empty
				if (args.includes("ls-tree") && args.includes(commitSha))
					return createMockOutput("");
				// ^3 doesn't exist (not a stash) — throw error
				if (args.includes("ls-tree") && args.includes(`${commitSha}^3`))
					return Promise.reject(new Error("Not a valid object name"));
				return createMockOutput("");
			});

			const result = await computeDiffStats("origin/main", {
				fixBase: commitSha,
			});

			// Without ^3, file1.md is counted as new (original behavior)
			expect(result.newFiles).toBe(1);
			expect(result.total).toBe(1);
		});
	});
});
