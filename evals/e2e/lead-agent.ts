import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseLeadStream } from "./lead-transcript.js";
import type { E2ELeadConfig, LeadActivity, LeadResult } from "./types.js";

/** Invokes the validator-run skill explicitly, as a user would after an agent finished the feature. */
export const LEAD_PROMPT = "/validator-run";

/** Session variables from the Claude Code that launched the eval, which must not leak into the lead agent. */
const INHERITED_SESSION_VARS = [
	"CLAUDECODE",
	"CLAUDE_CODE_ENTRYPOINT",
	"CLAUDE_CODE_EFFORT_LEVEL",
	"CLAUDE_CODE_SSE_PORT",
];

export function buildLeadArgs(lead: E2ELeadConfig): string[] {
	const args = [
		"-p",
		LEAD_PROMPT,
		"--model",
		lead.model,
		// Stream every event so the transcript shows which skills and commands the lead used.
		"--output-format",
		"stream-json",
		"--verbose",
		// Project settings only: the workspace's skills, none of the user's hooks, plugins or MCP servers.
		"--setting-sources",
		"project",
		"--strict-mcp-config",
		"--dangerously-skip-permissions",
		"--no-session-persistence",
	];
	if (lead.effort) args.push("--effort", lead.effort);
	if (lead.max_budget_usd !== undefined) {
		args.push("--max-budget-usd", String(lead.max_budget_usd));
	}
	return args;
}

export function buildLeadEnv(binDir: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env = { ...parent };
	for (const name of INHERITED_SESSION_VARS) delete env[name];
	env.PATH = `${binDir}:${parent.PATH ?? ""}`;
	return env;
}

/** Runs the lead agent headless in the workspace repo until it stops. */
export function runLeadAgent(
	lead: E2ELeadConfig,
	repo: string,
	binDir: string,
	transcriptPath: string,
): Promise<LeadResult> {
	const start = Date.now();
	return new Promise((resolve) => {
		const child = spawn("claude", buildLeadArgs(lead), {
			cwd: repo,
			env: buildLeadEnv(binDir),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, lead.timeout_ms);
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve(failedLead(Date.now() - start, null, timedOut, err.message, emptyActivity()));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			writeFileSync(transcriptPath, stdout);
			resolve({
				...parseLeadOutput(stdout, stderr, code, timedOut, Date.now() - start),
				transcriptPath,
			});
		});
	});
}

export function parseLeadOutput(
	stdout: string,
	stderr: string,
	exitCode: number | null,
	timedOut: boolean,
	durationMs: number,
): LeadResult {
	const { result, activity } = parseLeadStream(stdout, LEAD_PROMPT);
	if (!result) {
		const detail = (stderr || stdout).trim().slice(-2000);
		return failedLead(durationMs, exitCode, timedOut, `Lead produced no result event: ${detail}`, activity);
	}
	const cost = result.total_cost_usd;
	const turns = result.num_turns;
	return {
		exitCode,
		timedOut,
		durationMs,
		costUsd: typeof cost === "number" ? cost : null,
		numTurns: typeof turns === "number" ? turns : null,
		isError: result.is_error === true || timedOut,
		finalMessage: typeof result.result === "string" ? result.result : "",
		activity,
		...(result.is_error === true && { error: String(result.subtype ?? "lead reported an error") }),
	};
}

function emptyActivity(): LeadActivity {
	return { promptSkill: null, promptSkillLoaded: false, skillCalls: [], validatorCommands: [] };
}

function failedLead(
	durationMs: number,
	exitCode: number | null,
	timedOut: boolean,
	error: string,
	activity: LeadActivity,
): LeadResult {
	return {
		exitCode,
		timedOut,
		durationMs,
		costUsd: null,
		numTurns: null,
		isError: true,
		finalMessage: "",
		activity,
		error: timedOut ? `Timed out. ${error}` : error,
	};
}
