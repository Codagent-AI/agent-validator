import { chmod, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";

const entrypoints = ["./src/index.ts", "./src/scripts/status.ts"];

const define: Record<string, string> = {};
if (process.env.INJECT_GIT_VERSION) {
	try {
		const sha = execSync("git rev-parse --short HEAD").toString().trim();
		const subject = execSync("git log -1 --format=%s").toString().trim();
		define.BUILD_GIT_SHA = JSON.stringify(`${sha} ${subject}`);
	} catch {
		console.warn("Warning: failed to read git version info; BUILD_GIT_SHA will be 'unknown'");
		define.BUILD_GIT_SHA = JSON.stringify("unknown");
	}
}

const result = await Bun.build({
	entrypoints,
	outdir: "./dist",
	target: "node",
	format: "esm",
	packages: "external",
	sourcemap: "external",
	define,
});

if (!result.success) {
	console.error("Build failed:");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

// Prepend shebang and chmod +x for each entry point
const shebang = "#!/usr/bin/env node\n";

for (const entry of entrypoints) {
	const relPath = path.relative("./src", entry).replace(/\.ts$/, ".js");
	const outPath = path.join("./dist", relPath);

	const content = await readFile(outPath, "utf-8");
	if (!content.startsWith("#!")) {
		await writeFile(outPath, shebang + content);
	}
	await chmod(outPath, 0o755);
}

console.log(
	`Built ${result.outputs.length} files to dist/`,
);
