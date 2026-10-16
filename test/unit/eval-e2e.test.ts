import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { validatorConfigSchema } from "../../src/config/schema.js";
import { buildValidatorConfig, validateE2EConfig } from "../../evals/e2e/config.js";
import { buildLeadArgs, buildLeadEnv, parseLeadOutput } from "../../evals/e2e/lead-agent.js";
import { parseLeadStream, promptSkill } from "../../evals/e2e/lead-transcript.js";
import { parseOracleResponse } from "../../evals/e2e/oracle.js";
import { scoreE2ERun, summarizeE2E } from "../../evals/e2e/scoring.js";
import type { E2ERunResult } from "../../evals/e2e/types.js";
import { collectValidatorEvidence } from "../../evals/e2e/validator-evidence.js";
import { createWorkspace, diffTrees, snapshotTree } from "../../evals/e2e/workspace.js";

const reviewer = {
	label: "haiku-3review",
	adapter: "claude" as const,
	model: "claude-haiku-5-5",
	thinking_budget: "low",
	reviews: ["code-quality", "security", "error-handling"],
};

const gt = (id: string) => ({
	id,
	file: "a.ts",
	line_range: [1, 1] as [number, number],
	description: id,
	category: "bug" as const,
	difficulty: "easy" as const,
	priority: "high" as const,
	requires_tool_use: false,
});

describe("e2e config", () => {
	const base = {
		fixture: "fixtures/all-reviewers",
		lead: { model: "claude-opus-5-5" },
		judge: { adapter: "claude", thinking_budget: "high" },
		configs: [reviewer],
	};

	it("fills defaults", () => {
		const config = validateE2EConfig(base);
		expect(config.runs_per_config).toBe(1);
		expect(config.lead.timeout_ms).toBe(3_600_000);
	});

	it("rejects unknown built-in reviews and duplicate labels", () => {
		expect(() => validateE2EConfig({ ...base, configs: [{ ...reviewer, reviews: ["nope"] }] })).toThrow(
			/Unknown built-in review/,
		);
		expect(() => validateE2EConfig({ ...base, configs: [reviewer, reviewer] })).toThrow(/Duplicate/);
	});

	it("builds a validator config the validator accepts, one review gate per review", () => {
		const parsed = validatorConfigSchema.parse(YAML.parse(buildValidatorConfig(reviewer)));
		expect(parsed.base_branch).toBe("main");
		expect(parsed.cli?.adapters?.claude?.model).toBe("claude-haiku-5-5");
		expect(parsed.entry_points[0]?.reviews).toHaveLength(3);
	});
});

describe("lead agent", () => {
	it("isolates the lead from user settings and the launching session", () => {
		const args = buildLeadArgs({ model: "claude-opus-5-5", effort: "high", timeout_ms: 1, max_budget_usd: 5 });
		expect(args).toContain("--strict-mcp-config");
		expect(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2)).toEqual([
			"--setting-sources",
			"project",
		]);
		expect(args.slice(-4)).toEqual(["--effort", "high", "--max-budget-usd", "5"]);

		const env = buildLeadEnv("/shim", { PATH: "/usr/bin", CLAUDECODE: "1", CLAUDE_CODE_EFFORT_LEVEL: "max" });
		expect(env.PATH).toBe("/shim:/usr/bin");
		expect(env.CLAUDECODE).toBeUndefined();
		expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
	});

	const stream = (...events: object[]) => events.map((e) => JSON.stringify(e)).join("\n");
	const init = { type: "system", subtype: "init", skills: ["validator-run", "validator-skip"] };
	const toolUse = (name: string, input: object) => ({
		type: "assistant",
		message: { content: [{ type: "tool_use", name, input }] },
	});

	it("parses Claude Code's stream-json result", () => {
		const lead = parseLeadOutput(
			stream(init, { type: "result", total_cost_usd: 1.25, num_turns: 40, is_error: false, result: "Done" }),
			"",
			0,
			false,
			1000,
		);
		expect(lead).toMatchObject({ costUsd: 1.25, numTurns: 40, isError: false, finalMessage: "Done" });
		expect(lead.activity.promptSkillLoaded).toBe(true);
	});

	it("reports a stream without a result event as an error with unknown cost", () => {
		const lead = parseLeadOutput("crash", "boom", 1, false, 1000);
		expect(lead.isError).toBe(true);
		expect(lead.costUsd).toBeNull();
		expect(lead.error).toContain("boom");
	});

	it("records skills and validator commands the lead used", () => {
		const { activity } = parseLeadStream(
			stream(
				init,
				toolUse("Bash", { command: "agent-validate run" }),
				toolUse("Skill", { skill: "validator-skip" }),
				toolUse("Bash", { command: "git status" }),
				toolUse("Bash", { command: 'agent-validate update-review fix 3 "done"' }),
			),
			"/validator-run",
		);
		expect(activity).toEqual({
			promptSkill: "validator-run",
			promptSkillLoaded: true,
			skillCalls: ["validator-skip"],
			validatorCommands: ["agent-validate run", 'agent-validate update-review fix 3 "done"'],
		});
	});

	it("flags a prompt skill the session did not load", () => {
		const { activity } = parseLeadStream(stream({ ...init, skills: [] }), "/validator-run");
		expect(activity.promptSkillLoaded).toBe(false);
		expect(promptSkill("Run the validator")).toBeNull();
	});
});

function attempt(id: string, revision: number, usd: number | null) {
	return {
		attempt_id: id,
		revision,
		provider_reported_costs:
			usd === null ? [] : [{ amount: { value: usd }, scope: "attempt", coverage: "full" }],
	};
}

describe("collectValidatorEvidence", () => {
	function logDir() {
		const dir = mkdtempSync(join(tmpdir(), "e2e-evidence-"));
		mkdirSync(join(dir, "previous"));
		// The archived snapshot and the current one both hold attempt a1.
		writeFileSync(
			join(dir, "previous", "validation-metrics.json"),
			JSON.stringify({ invocations: [{ invocation_id: "i1", command: "run" }], attempts: [attempt("a1", 1, 0.02)] }),
		);
		writeFileSync(
			join(dir, "validation-metrics.json"),
			JSON.stringify({
				invocations: [
					{ invocation_id: "i1", command: "run" },
					{ invocation_id: "i2", command: "run" },
				],
				attempts: [attempt("a1", 2, 0.02), attempt("a2", 1, 0.03)],
			}),
		);
		writeFileSync(
			join(dir, "previous", "review_._security_claude@1.1.json"),
			JSON.stringify({
				violations: [
					{ file: "a.ts", line: 1, issue: "x", priority: "high", status: "fixed", result: "done" },
					{ file: "a.ts", line: 9, issue: "y", priority: "low", status: "skipped", result: "style" },
				],
			}),
		);
		writeFileSync(
			join(dir, "review_._security_claude@1.2.json"),
			JSON.stringify({ violations: [{ file: "b.ts", line: 2, issue: "z", priority: "high" }] }),
		);
		writeFileSync(join(dir, "previous", "console.1.log"), "Status: Failed\n");
		writeFileSync(join(dir, "console.2.log"), "Status: Passed\n");
		utimesSync(join(dir, "previous", "console.1.log"), new Date(1000), new Date(1000));
		return dir;
	}

	it("dedupes records across snapshots and gathers every run's findings", () => {
		const evidence = collectValidatorEvidence(logDir());
		expect(evidence.validatorRuns).toBe(2);
		expect(evidence.reviewerAttempts).toBe(2);
		expect(evidence.reviewerCostUsd).toBeCloseTo(0.05);
		expect(evidence.findings.map((f) => f.status).sort()).toEqual(["fixed", "new", "skipped"]);
		expect(evidence.finalStatus).toBe("Passed");
	});

	it("leaves reviewer cost unknown when an attempt has no reported cost", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-evidence-"));
		writeFileSync(
			join(dir, "validation-metrics.json"),
			JSON.stringify({ attempts: [attempt("a1", 1, 0.02), attempt("a2", 1, null)] }),
		);
		const evidence = collectValidatorEvidence(dir);
		expect(evidence.reviewerCostUsd).toBeNull();
		expect(evidence.reviewerCostedAttempts).toBe(1);
	});

	it("handles a missing log directory", () => {
		const evidence = collectValidatorEvidence(join(tmpdir(), "does-not-exist-e2e"));
		expect(evidence).toMatchObject({ validatorRuns: 0, findings: [], finalStatus: null });
	});
});

describe("parseOracleResponse", () => {
	it("gives every seeded issue one verdict, defaulting to not fixed", () => {
		const parsed = parseOracleResponse(
			{
				issues: [
					{ id: "x", verdict: "fixed", reasoning: "ok" },
					{ id: "x", verdict: "not_fixed" },
					{ id: "y", verdict: "bogus" },
				],
				regressions: [{ file: "a.ts", description: "broke it", severity: "critical" }],
			},
			[gt("x"), gt("y"), gt("z")],
		);
		expect(parsed.issues.map((i) => [i.id, i.verdict])).toEqual([
			["x", "fixed"],
			["y", "not_fixed"],
			["z", "not_fixed"],
		]);
		expect(parsed.regressions[0]?.severity).toBe("medium");
	});
});

function runResult(label: string, leadCost: number | null, fixedIds: string[]): E2ERunResult {
	return {
		configLabel: label,
		runIndex: 0,
		workspace: "/tmp/w",
		lead: {
			exitCode: 0,
			timedOut: false,
			durationMs: 1,
			costUsd: leadCost,
			numTurns: 3,
			isError: false,
			finalMessage: "",
			activity: { promptSkill: "validator-run", promptSkillLoaded: true, skillCalls: [], validatorCommands: [] },
		},
		evidence: {
			validatorRuns: 2,
			reviewerCostUsd: 0.1,
			reviewerCostedAttempts: 1,
			reviewerAttempts: 1,
			findings: [
				{ source: "r.json", file: "a.ts", line: 1, issue: "x", priority: "high", status: "fixed" },
				{ source: "r.json", file: "a.ts", line: 2, issue: "y", priority: "low", status: "skipped" },
			],
			finalStatus: "Passed",
		},
		agentDiff: "",
		oracle: {
			issues: ["x", "y"].map((id) => ({
				id,
				verdict: fixedIds.includes(id) ? ("fixed" as const) : ("not_fixed" as const),
				reasoning: "",
			})),
			regressions: [{ file: "a.ts", description: "d", severity: "low" }],
			syntax: [{ file: "a.ts", ok: true }],
			reasoning: "",
		},
		wallClockMs: 60_000,
	};
}

describe("scoring", () => {
	it("scores fixes, decisions and total cost", () => {
		const score = scoreE2ERun(runResult("c", 1.9, ["x"]));
		expect(score).toMatchObject({
			fixed: 1,
			notFixed: 1,
			regressions: 1,
			fixDecisions: 1,
			skipDecisions: 1,
			validatorRuns: 2,
		});
		expect(score.totalCostUsd).toBeCloseTo(2.0);
	});

	it("summarizes per config and keeps unknown cost unknown", () => {
		const [known, unknown] = summarizeE2E([
			scoreE2ERun(runResult("a", 1.9, ["x", "y"])),
			scoreE2ERun(runResult("b", null, ["x"])),
		]);
		expect(known?.costPerFixUsd).toBeCloseTo(1.0);
		expect(known?.meanFixRate).toBe(1);
		expect(unknown?.meanTotalCostUsd).toBeNull();
		expect(unknown?.costPerFixUsd).toBeNull();
	});
});

describe("createWorkspace", () => {
	const validatorRoot = new URL("../../", import.meta.url).pathname;
	const fixtureDir = join(validatorRoot, "evals", "fixtures", "all-reviewers");

	it("commits base, config and skills to main and leaves the feature uncommitted", () => {
		const workspace = createWorkspace({ fixtureDir, validatorRoot, reviewer });
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: workspace.repo, encoding: "utf-8" });

		expect(git("branch", "--show-current").trim()).toBe("feature");
		expect(git("ls-tree", "-r", "--name-only", "main")).toContain(".claude/skills/validator-run/SKILL.md");
		const status = git("status", "--porcelain");
		expect(status).toContain("?? src/batch_processor.py");
		expect(status).toContain(" M src/api/handler.ts");
		expect(readFileSync(join(workspace.binDir, "agent-validate"), "utf-8")).toContain("dist/index.js");

		writeFileSync(join(workspace.repo, "src", "new.ts"), "export const x = 1;\n");
		const finalTree = snapshotTree(workspace.repo, workspace.root);
		expect(diffTrees(workspace.repo, workspace.initialTree, finalTree)).toContain("+export const x = 1;");
		// Snapshots must not touch the real index.
		expect(git("status", "--porcelain")).toContain("?? src/new.ts");
	});
});
