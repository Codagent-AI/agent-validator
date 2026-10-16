import { runE2E } from "./runner.js";

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
	const prefix = `--${name}=`;
	return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const configPath = getArg("e2e-config");
if (!configPath) {
	console.error("Usage: bun evals/e2e/run-e2e.ts --e2e-config=<file> [--config=<label>] [--runs=N] [--dry-run] [--skip-oracle]");
	process.exit(1);
}
const runs = getArg("runs");

console.log("End-to-End Validator Eval");
console.log("=========================");

await runE2E({
	configPath,
	configFilter: getArg("config"),
	runs: runs ? Number(runs) : undefined,
	dryRun: args.includes("--dry-run"),
	skipOracle: args.includes("--skip-oracle"),
});
