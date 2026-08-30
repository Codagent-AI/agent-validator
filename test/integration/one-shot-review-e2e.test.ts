import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	createRecordingCodexStub,
	initGitRepo,
	isDistBuilt,
	type RecordingCodexStub,
	spawnValidator,
} from "./helpers.js";

const TIMEOUT_MS = 60_000;
const tempDirs: string[] = [];
const stubs: RecordingCodexStub[] = [];
let canRun: boolean;

beforeAll(() => {
	canRun = isDistBuilt();
});

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
	await Promise.all(stubs.splice(0).map((stub) => stub.cleanup()));
});

async function createReviewRepo(includeOrdinaryReview = false): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-review-e2e-"));
	tempDirs.push(dir);
	await fs.mkdir(path.join(dir, ".validator"));
	const ordinaryReview = includeOrdinaryReview
		? `
      - all-reviewers:
          builtin: all-reviewers
          parallel: false`
		: "";
	await fs.writeFile(
		path.join(dir, ".validator", "config.yml"),
		`base_branch: main
log_dir: validator_logs
allow_parallel: false
cli:
  default_preference:
    - codex
  adapters:
    codex:
      allow_tool_use: false
entry_points:
  - path: "."
    reviews:
      - task-compliance:
          builtin: task-compliance
          parallel: false${ordinaryReview}
`,
	);
	await fs.writeFile(path.join(dir, ".gitignore"), "validator_logs/\n");
	await fs.writeFile(
		path.join(dir, "legacy.ts"),
		'export const legacyBehavior = "baseline";\n',
	);
	await fs.writeFile(
		path.join(dir, "task.ts"),
		'export const taskBehavior = "initial";\n',
	);
	await fs.writeFile(
		path.join(dir, "other.ts"),
		'export const otherBehavior = "initial";\n',
	);
	await initGitRepo(dir);
	return dir;
}

function reviewEnv(stub: RecordingCodexStub): Record<string, string | undefined> {
	return {
		...process.env,
		CI: undefined,
		GITHUB_ACTIONS: undefined,
		GITHUB_BASE_REF: undefined,
		GITHUB_SHA: undefined,
		PATH: `${stub.binDir}:${process.env.PATH ?? ""}`,
		FAKE_CODEX_CAPTURE_DIR: stub.captureDir,
		FAKE_CODEX_MODE_FILE: stub.modeFile,
	};
}

async function runTaskCompliance(repo: string, stub: RecordingCodexStub) {
	return spawnValidator(
		[
			"run",
			"--gate",
			"task-compliance",
			"--enable-review",
			"task-compliance",
			"--report",
		],
		{ cwd: repo, env: reviewEnv(stub), timeoutMs: TIMEOUT_MS },
	);
}

async function runAllReviews(repo: string, stub: RecordingCodexStub) {
	return spawnValidator(
		["run", "--enable-review", "task-compliance", "--report"],
		{ cwd: repo, env: reviewEnv(stub), timeoutMs: TIMEOUT_MS },
	);
}

async function establishIncrementalSnapshot(
	repo: string,
	stub: RecordingCodexStub,
): Promise<void> {
	await fs.writeFile(
		path.join(repo, "legacy.ts"),
		'export const legacyBehavior = "old branch-wide change";\n',
	);
	const result = await runTaskCompliance(repo, stub);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("Status: Passed");
}

async function setupScenario(includeOrdinaryReview = false): Promise<{
	repo: string;
	stub: RecordingCodexStub;
}> {
	const repo = await createReviewRepo(includeOrdinaryReview);
	const stub = await createRecordingCodexStub();
	stubs.push(stub);
	await establishIncrementalSnapshot(repo, stub);
	return { repo, stub };
}

describe("one-shot review E2E", () => {
	it(
		"keeps the incremental scope on first dispatch and adapter-error retry",
		async () => {
			if (!canRun) return;
			const { repo, stub } = await setupScenario();
			await fs.writeFile(
				path.join(repo, "task.ts"),
				'export const taskBehavior = "new task-local change";\n',
			);
			await stub.setMode("process-error");

			const failed = await runTaskCompliance(repo, stub);
			expect(failed.exitCode).toBe(1);
			const failedJson = JSON.parse(
				await fs.readFile(
					path.join(
						repo,
						"validator_logs",
						"review_._task-compliance_codex@1.1.json",
					),
					"utf8",
				),
			);

			await fs.writeFile(
				path.join(repo, "task.ts"),
				'export const taskBehavior = "new task-local change";\nexport const retryAdjustment = true;\n',
			);
			await stub.setMode("pass");
			const retried = await runTaskCompliance(repo, stub);
			expect(retried.exitCode).toBe(0);

			const captures = await stub.readCaptures();
			expect(captures).toHaveLength(3);
			expect(captures[1]).toContain("diff --git a/task.ts b/task.ts");
			expect(captures[1]).not.toContain("diff --git a/legacy.ts b/legacy.ts");
			expect(captures[2]).toContain("new task-local change");
			expect(captures[2]).toContain("retryAdjustment");
			expect(captures[2]).not.toContain("diff --git a/legacy.ts b/legacy.ts");
			expect(captures[2]).not.toContain("RERUN MODE");

			const retriedJson = JSON.parse(
				await fs.readFile(
					path.join(
						repo,
						"validator_logs",
						"previous",
						"review_._task-compliance_codex@1.2.json",
					),
					"utf8",
				),
			);
			expect(retriedJson.reviewScope).toEqual(failedJson.reviewScope);
		},
		{ timeout: TIMEOUT_MS },
	);

	it(
		"redispatches an adapter error when no files changed before retry",
		async () => {
			if (!canRun) return;
			const { repo, stub } = await setupScenario();
			await fs.writeFile(
				path.join(repo, "task.ts"),
				'export const taskBehavior = "new task-local change";\n',
			);
			await stub.setMode("process-error");
			expect((await runTaskCompliance(repo, stub)).exitCode).toBe(1);

			await stub.setMode("pass");
			const retried = await runTaskCompliance(repo, stub);
			const captures = await stub.readCaptures();

			expect(retried.exitCode).toBe(0);
			expect(retried.stderr).toContain(
				"No changes detected, but 1 previous failed gate(s) will be re-run.",
			);
			expect(captures).toHaveLength(3);
			expect(captures[2]).toContain("new task-local change");
			expect(captures[2]).not.toContain("diff --git a/legacy.ts b/legacy.ts");
			expect(captures[2]).not.toContain("RERUN MODE");
		},
		{ timeout: TIMEOUT_MS },
	);

	it(
		"keeps retry scope local to the errored one-shot review",
		async () => {
			if (!canRun) return;
			const { repo, stub } = await setupScenario(true);
			await fs.writeFile(
				path.join(repo, "task.ts"),
				'export const taskBehavior = "errored task change";\n',
			);
			await stub.setMode("process-error");
			expect((await runTaskCompliance(repo, stub)).exitCode).toBe(1);

			await fs.writeFile(
				path.join(repo, "other.ts"),
				'export const otherBehavior = "new unrelated change";\n',
			);
			await stub.setMode("pass");
			expect((await runAllReviews(repo, stub)).exitCode).toBe(0);

			const captures = await stub.readCaptures();
			expect(captures).toHaveLength(4);
			expect(captures[2]).toContain("errored task change");
			expect(captures[3]).toContain("new unrelated change");
			expect(captures[3]).not.toContain("errored task change");
		},
		{ timeout: TIMEOUT_MS },
	);

	it(
		"preserves a substantive one-shot result without another adapter call",
		async () => {
			if (!canRun) return;
			const { repo, stub } = await setupScenario();
			await fs.writeFile(
				path.join(repo, "task.ts"),
				'export const taskBehavior = "initial";\nexport const reviewedChange = true;\n',
			);
			await stub.setMode("review-fail");
			expect((await runTaskCompliance(repo, stub)).exitCode).toBe(1);
			expect(await stub.readCaptures()).toHaveLength(2);

			await fs.appendFile(
				path.join(repo, "task.ts"),
				"export const postReviewChange = true;\n",
			);
			await stub.setMode("pass");
			const preserved = await runTaskCompliance(repo, stub);

			expect(preserved.exitCode).toBe(1);
			expect(await stub.readCaptures()).toHaveLength(2);
			const preservedJson = JSON.parse(
				await fs.readFile(
					path.join(
						repo,
						"validator_logs",
						"review_._task-compliance_codex@1.2.json",
					),
					"utf8",
				),
			);
			expect(preservedJson.preservedFromIteration).toBe(1);
		},
		{ timeout: TIMEOUT_MS },
	);
});
