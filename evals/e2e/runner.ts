import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import YAML from "yaml";
import type { GroundTruthIssue } from "../types.js";
import { loadE2EConfig } from "./config.js";
import { runLeadAgent } from "./lead-agent.js";
import { runOracle } from "./oracle.js";
import { formatRunLine, formatRunTable, formatSummaryTable } from "./report.js";
import { scoreE2ERun, summarizeE2E } from "./scoring.js";
import type { E2EConfig, E2ERunResult, E2EReviewerConfig, LeadResult, OracleResult } from "./types.js";
import { collectValidatorEvidence } from "./validator-evidence.js";
import { createWorkspace, diffTrees, snapshotTree } from "./workspace.js";

export interface RunE2EOptions {
	configPath: string;
	configFilter?: string;
	runs?: number;
	dryRun?: boolean;
	skipOracle?: boolean;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".py", ".go"]);

function sourceFilesInTree(repo: string, tree: string): string[] {
	return execFileSync("git", ["ls-tree", "-r", "--name-only", tree], { cwd: repo, encoding: "utf-8" })
		.split("\n")
		.filter((f) => SOURCE_EXTENSIONS.has(extname(f)) && !f.startsWith(".claude/"));
}

const SKIPPED_ORACLE = (groundTruth: GroundTruthIssue[]): OracleResult => ({
	issues: groundTruth.map((gt) => ({ id: gt.id, verdict: "not_fixed", reasoning: "Oracle skipped." })),
	regressions: [],
	syntax: [],
	reasoning: "",
	error: "skipped",
});

async function runOne(
	evalConfig: E2EConfig,
	reviewer: E2EReviewerConfig,
	runIndex: number,
	context: { fixtureDir: string; validatorRoot: string; groundTruth: GroundTruthIssue[]; skipOracle: boolean },
): Promise<E2ERunResult> {
	const start = Date.now();
	const workspace = createWorkspace({ fixtureDir: context.fixtureDir, validatorRoot: context.validatorRoot, reviewer });
	console.log(`  workspace: ${workspace.repo}`);

	const lead: LeadResult = await runLeadAgent(
		evalConfig.lead,
		workspace.repo,
		workspace.binDir,
		join(workspace.root, "lead-transcript.jsonl"),
	);
	const wallClockMs = Date.now() - start;
	if (lead.error) console.log(`  lead error: ${lead.error}`);
	const { activity } = lead;
	console.log(
		`  lead: prompt skill ${activity.promptSkill ?? "none"} ${activity.promptSkillLoaded ? "loaded" : "NOT loaded"}; ` +
			`other skills [${activity.skillCalls.join(", ")}]; validator commands ${activity.validatorCommands.length}`,
	);

	const evidence = collectValidatorEvidence(join(workspace.repo, "validator_logs"));
	const finalTree = snapshotTree(workspace.repo, workspace.root);
	const agentDiff = diffTrees(workspace.repo, workspace.initialTree, finalTree);
	const oracle = context.skipOracle
		? SKIPPED_ORACLE(context.groundTruth)
		: await runOracle({
				repo: workspace.repo,
				sourceFiles: sourceFilesInTree(workspace.repo, finalTree),
				agentDiff,
				groundTruth: context.groundTruth,
				judge: evalConfig.judge,
			});
	if (oracle.error && !context.skipOracle) console.log(`  oracle error: ${oracle.error}`);

	return {
		configLabel: reviewer.label,
		runIndex,
		workspace: workspace.root,
		lead,
		evidence,
		agentDiff,
		oracle,
		wallClockMs,
	};
}

function writeResults(path: string, evalConfig: E2EConfig, results: E2ERunResult[]): void {
	const scores = results.map(scoreE2ERun);
	writeFileSync(
		path,
		JSON.stringify({ timestamp: new Date().toISOString(), config: evalConfig, scores, summary: summarizeE2E(scores), results }, null, 2),
	);
}

/** Runs every reviewer config × rep sequentially, saving results after each run. */
export async function runE2E(options: RunE2EOptions): Promise<E2ERunResult[]> {
	const evalsDir = resolve(new URL("..", import.meta.url).pathname);
	const validatorRoot = resolve(evalsDir, "..");
	const evalConfig = loadE2EConfig(resolve(options.configPath));
	const fixtureDir = resolve(evalsDir, evalConfig.fixture);
	if (!existsSync(join(fixtureDir, "base"))) throw new Error(`Fixture ${fixtureDir} has no base/ directory`);
	if (!existsSync(join(validatorRoot, "dist", "index.js"))) {
		throw new Error("dist/index.js not found. Run `bun run build:npm` first.");
	}
	const groundTruth: GroundTruthIssue[] = YAML.parse(readFileSync(join(fixtureDir, "ground-truth.yml"), "utf-8")).issues;
	const reviewers = evalConfig.configs.filter((c) => !options.configFilter || c.label === options.configFilter);
	if (reviewers.length === 0) throw new Error(`No config labeled "${options.configFilter}"`);
	const runs = options.runs ?? evalConfig.runs_per_config;

	console.log(`Fixture: ${evalConfig.fixture} (${groundTruth.length} seeded issues)`);
	console.log(`Lead: ${evalConfig.lead.model}${evalConfig.lead.effort ? ` (${evalConfig.lead.effort})` : ""}`);
	console.log(`Configs: ${reviewers.map((r) => r.label).join(", ")}; runs each: ${runs}`);
	if (options.dryRun) {
		const workspace = createWorkspace({ fixtureDir, validatorRoot, reviewer: reviewers[0] as E2EReviewerConfig });
		console.log(`Dry run: created sample workspace at ${workspace.repo}`);
		return [];
	}

	const resultsDir = join(evalsDir, "results");
	mkdirSync(resultsDir, { recursive: true });
	const resultsPath = join(resultsDir, `e2e-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
	const results: E2ERunResult[] = [];
	for (const reviewer of reviewers) {
		for (let runIndex = 0; runIndex < runs; runIndex++) {
			console.log(`\n[${reviewer.label}] run ${runIndex + 1}/${runs}`);
			const result = await runOne(evalConfig, reviewer, runIndex, {
				fixtureDir,
				validatorRoot,
				groundTruth,
				skipOracle: options.skipOracle ?? false,
			});
			results.push(result);
			console.log(formatRunLine(scoreE2ERun(result)));
			writeResults(resultsPath, evalConfig, results);
		}
	}

	const scores = results.map(scoreE2ERun);
	console.log(`\n${formatRunTable(scores)}\n\n${formatSummaryTable(summarizeE2E(scores))}`);
	console.log(`\nResults: ${resultsPath}`);
	return results;
}
