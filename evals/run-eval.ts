import { runEval } from "./runner.js";

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
	const prefix = `--${name}=`;
	const arg = args.find((a) => a.startsWith(prefix));
	return arg?.slice(prefix.length);
}

const options = {
	adapterFilter: getArg("adapter"),
	configFilter: getArg("config"),
	dryRun: args.includes("--dry-run"),
	skipJudge: args.includes("--skip-judge"),
};

console.log("Review Eval Framework");
console.log("=====================");

if (options.dryRun) console.log("Mode: dry run (no adapter calls)");
if (options.skipJudge) console.log("Mode: skip judge scoring");
if (options.adapterFilter)
	console.log(`Filter: adapter=${options.adapterFilter}`);
if (options.configFilter) console.log(`Filter: config=${options.configFilter}`);

await runEval(options);
