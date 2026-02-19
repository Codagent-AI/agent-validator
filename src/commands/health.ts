import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { getAdapter, getAllAdapters } from "../cli-adapters/index.js";
import { loadConfig } from "../config/loader.js";
import { validateConfig } from "../config/validator.js";

export function registerHealthCommand(program: Command): void {
	program
		.command("health")
		.description("Check CLI tool availability")
		.action(async () => {
			// 1. Config validation
			console.log(chalk.bold("Config validation:"));
			const validationResult = await validateConfig();

			if (validationResult.filesChecked.length === 0) {
				console.log(chalk.yellow("  No config files found"));
			} else {
				// List all files checked
				for (const file of validationResult.filesChecked) {
					const relativePath = path.relative(process.cwd(), file);
					console.log(chalk.dim(`  ${relativePath}`));
				}

				// Show validation results
				if (validationResult.valid && validationResult.issues.length === 0) {
					console.log(chalk.green("  ✓ All config files are valid"));
				} else {
					// Group issues by file
					const issuesByFile = new Map<
						string,
						typeof validationResult.issues
					>();
					for (const issue of validationResult.issues) {
						const relativeFile = path.relative(process.cwd(), issue.file);
						if (!issuesByFile.has(relativeFile)) {
							issuesByFile.set(relativeFile, []);
						}
						issuesByFile.get(relativeFile)?.push(issue);
					}

					// Display issues
					for (const [file, issues] of issuesByFile.entries()) {
						for (const issue of issues) {
							const icon =
								issue.severity === "error" ? chalk.red("✗") : chalk.yellow("⚠");
							const fieldInfo = issue.field
								? chalk.dim(` (${issue.field})`)
								: "";
							console.log(`  ${icon} ${file}${fieldInfo}`);
							console.log(`    ${issue.message}`);
						}
					}
				}
			}

			console.log();

			// 2. CLI Tool Health Check
			console.log(chalk.bold("CLI Tool Health Check:"));

			try {
				const config = await loadConfig();

				// Check for reviews configuration
				const reviewEntries = Object.entries(config.reviews);

				if (reviewEntries.length === 0) {
					console.log(chalk.yellow("  No CLI tools configured"));
					console.log(
						chalk.dim(
							"  No review gates found. Add review gates with cli_preference to check tool availability.",
						),
					);
					return;
				}

				// Collect all unique agent names from review gate cli_preference settings
				const preferredAgents = new Set<string>();
				const reviewsWithEmptyPreference: string[] = [];

				for (const [reviewName, review] of reviewEntries) {
					if (!review.cli_preference || review.cli_preference.length === 0) {
						reviewsWithEmptyPreference.push(reviewName);
					} else {
						for (const agent of review.cli_preference) {
							preferredAgents.add(agent);
						}
					}
				}

				// Report Empty Preferences (Loader should handle this via default merging, but good to check)
				if (reviewsWithEmptyPreference.length > 0) {
					console.log(chalk.yellow("  ⚠️  Misconfiguration detected:"));
					for (const name of reviewsWithEmptyPreference) {
						console.log(
							chalk.yellow(
								`     Review gate "${name}" has empty cli_preference`,
							),
						);
					}
					console.log();
				}

				// If no agents are configured, show message
				if (preferredAgents.size === 0) {
					console.log(chalk.yellow("  No CLI tools configured"));
					console.log(
						chalk.dim(
							"  All review gates have empty cli_preference. Add tools to cli_preference to check availability.",
						),
					);
					return;
				}

				// Check the configured agents
				for (const agentName of Array.from(preferredAgents).sort()) {
					const adapter = getAdapter(agentName);
					if (adapter) {
						const health = await adapter.checkHealth();
						let statusStr = "";

						switch (health.status) {
							case "healthy":
								statusStr = chalk.green("Installed");
								break;
							case "missing":
								statusStr = chalk.red("Missing");
								break;
							case "unhealthy":
								statusStr = chalk.red(`${health.message || "Unhealthy"}`);
								break;
						}

						console.log(`  ${adapter.name.padEnd(10)} : ${statusStr}`);
					} else {
						console.log(
							`  ${agentName.padEnd(10)} : ${chalk.yellow("Unknown")}`,
						);
					}
				}
			} catch (_error: unknown) {
				// If config can't be loaded, fall back to checking all adapters
				const adapters = getAllAdapters();
				console.log(
					chalk.dim("  (Config not found, checking all supported agents)"),
				);

				for (const adapter of adapters) {
					const health = await adapter.checkHealth();
					let statusStr = "";

					switch (health.status) {
						case "healthy":
							statusStr = chalk.green("Installed");
							break;
						case "missing":
							statusStr = chalk.red("Missing");
							break;
						case "unhealthy":
							statusStr = chalk.red(`${health.message || "Unhealthy"}`);
							break;
					}
					console.log(`  ${adapter.name.padEnd(10)} : ${statusStr}`);
				}
			}
		});
}
