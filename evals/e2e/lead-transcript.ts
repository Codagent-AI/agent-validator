import type { LeadActivity } from "./types.js";

interface StreamEvent {
	type?: string;
	subtype?: string;
	skills?: unknown;
	message?: { content?: unknown };
	[key: string]: unknown;
}

interface ToolUse {
	type?: string;
	name?: string;
	input?: Record<string, unknown>;
}

const VALIDATOR_COMMAND = /\bagent-validat(e|or)\b/;

function parseLines(stdout: string): StreamEvent[] {
	return stdout.split("\n").flatMap((line) => {
		if (!line.trim()) return [];
		try {
			return [JSON.parse(line) as StreamEvent];
		} catch {
			return [];
		}
	});
}

function toolUses(events: StreamEvent[]): ToolUse[] {
	return events
		.filter((e) => e.type === "assistant" && Array.isArray(e.message?.content))
		.flatMap((e) => e.message?.content as ToolUse[])
		.filter((c) => c.type === "tool_use");
}

/** The skill a `/skill-name` prompt invokes, if the prompt is a slash command. */
export function promptSkill(prompt: string): string | null {
	return prompt.match(/^\/([\w:-]+)/)?.[1] ?? null;
}

/**
 * Reads Claude Code `stream-json` output. A slash-command prompt expands its
 * skill inline without a Skill tool call, so it is confirmed from the session's
 * loaded skills; later skills appear as Skill tool calls. Validator commands
 * show whether the lead followed the skill or drove the validator directly.
 */
export function parseLeadStream(
	stdout: string,
	prompt: string,
): { result: StreamEvent | undefined; activity: LeadActivity } {
	const events = parseLines(stdout);
	const init = events.find((e) => e.type === "system" && e.subtype === "init");
	const loaded = Array.isArray(init?.skills) ? init.skills.map(String) : [];
	const skill = promptSkill(prompt);
	const uses = toolUses(events);
	return {
		result: events.findLast((e) => e.type === "result"),
		activity: {
			promptSkill: skill,
			promptSkillLoaded: skill !== null && loaded.includes(skill),
			skillCalls: uses.filter((u) => u.name === "Skill").map((u) => String(u.input?.skill ?? "")),
			validatorCommands: uses
				.filter((u) => u.name === "Bash" && VALIDATOR_COMMAND.test(String(u.input?.command ?? "")))
				.map((u) => String(u.input?.command)),
		},
	};
}
