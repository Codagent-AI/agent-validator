import { checkbox, confirm, number } from "@inquirer/prompts";
import chalk from "chalk";

export async function promptDevCLIs(
	detectedNames: string[],
	skipPrompts: boolean,
): Promise<string[]> {
	if (skipPrompts) return detectedNames;

	console.log();
	console.log(
		chalk.bold(
			"Select your development CLI(s). These are the main tools you work in.",
		),
	);
	const selected = await checkbox({
		message: "Development CLIs:",
		choices: detectedNames.map((name) => ({ name, value: name })),
		required: true,
	});
	return selected;
}

export async function promptReviewCLIs(
	detectedNames: string[],
	skipPrompts: boolean,
): Promise<string[]> {
	if (skipPrompts) return detectedNames;

	console.log();
	console.log(
		chalk.bold(
			"Select your reviewer CLI(s). These are the CLIs that will be used for AI code reviews.",
		),
	);
	const selected = await checkbox({
		message: "Review CLIs:",
		choices: detectedNames.map((name) => ({ name, value: name })),
		required: true,
	});
	return selected;
}

export async function promptNumReviews(
	reviewCliCount: number,
	skipPrompts: boolean,
): Promise<number> {
	if (reviewCliCount === 1) return 1;
	if (skipPrompts) return reviewCliCount;

	const result = await number({
		message: "How many of these CLIs would you like to run on every review?",
		min: 1,
		max: reviewCliCount,
		default: 1,
	});
	return result ?? 1;
}

export async function promptFileOverwrite(
	name: string,
	skipPrompts: boolean,
): Promise<boolean> {
	if (skipPrompts) return true;

	return confirm({
		message: `Skill \`${name}\` has changed, update it?`,
		default: true,
	});
}

export async function promptHookOverwrite(
	hookFile: string,
	skipPrompts: boolean,
): Promise<boolean> {
	if (skipPrompts) return true;

	return confirm({
		message: `Hook configuration in ${hookFile} has changed, update it?`,
		default: true,
	});
}
