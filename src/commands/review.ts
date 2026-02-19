import type { Command } from "commander";
import { executeGateCommand } from "./gate-command.js";

export function registerReviewCommand(program: Command): void {
	program
		.command("review")
		.description("Run only applicable reviews for detected changes")
		.option(
			"-b, --base-branch <branch>",
			"Override base branch for change detection",
		)
		.option("-g, --gate <name>", "Run specific review gate only")
		.option("-c, --commit <sha>", "Use diff for a specific commit")
		.option(
			"-u, --uncommitted",
			"Use diff for current uncommitted changes (staged and unstaged)",
		)
		.action((options) => executeGateCommand("review", options));
}
