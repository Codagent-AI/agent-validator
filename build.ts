import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const entrypoints = ["./src/index.ts", "./src/scripts/status.ts"];

const result = await Bun.build({
	entrypoints,
	outdir: "./dist",
	target: "node",
	format: "esm",
	packages: "external",
	sourcemap: "external",
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
	const basename = path.basename(entry, ".ts");
	// src/index.ts -> dist/index.js, src/scripts/status.ts -> dist/scripts/status.js
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
