import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig } from "../config/loader.js";

export function registerListCommand(program: Command): void {
	program
		.command("list")
		.description("List configured gates")
		.action(async () => {
			try {
				const config = await loadConfig();
				console.log(chalk.bold("Check Gates:"));
				for (const c of Object.values(config.checks)) {
					console.log(` - ${c.name}`);
				}

				console.log(chalk.bold("\nReview Gates:"));
				for (const r of Object.values(config.reviews)) {
					console.log(` - ${r.name} (Tools: ${r.cli_preference?.join(", ")})`);
				}

				console.log(chalk.bold("\nEntry Points:"));
				for (const ep of config.project.entry_points) {
					console.log(` - ${ep.path}`);
					if (ep.checks) console.log(`   Checks: ${ep.checks.join(", ")}`);
					if (ep.reviews) console.log(`   Reviews: ${ep.reviews.join(", ")}`);
				}
			} catch (error: unknown) {
				const err = error as { message?: string };
				console.error(chalk.red("Error:"), err.message);
			}
		});
}
