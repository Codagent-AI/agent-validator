#!/usr/bin/env bun

/**
 * Validates that no orphaned design docs exist outside openspec/changes
 *
 * Per openspec/AGENTS.md line 50:
 * "Move the design doc into the change dir: `mv docs/plans/YYYY-MM-DD-<topic>-design.md openspec/changes/<id>/design.md`.
 * YOU MUST use `mv`, do not copy it, because we want the one in openspec to be the single source of truth."
 *
 * This check ensures design docs are moved (not copied) to openspec/changes.
 */

import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const IGNORABLE_ERRORS = new Set(["EACCES", "ENOENT"]);
const DESIGN_DOC_PATTERN = /(?:^|-)design\.md$/;

function shouldSkipDir(dir: string): boolean {
	const dirName = basename(dir);
	if (SKIP_DIRS.has(dirName)) return true;
	return dir.replace(/^\.\//, "").startsWith("openspec/changes");
}

function findOrphanedDesignDocs(
	dir: string = ".",
	orphanedDocs: string[] = [],
): string[] {
	if (shouldSkipDir(dir)) return orphanedDocs;

	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				findOrphanedDesignDocs(fullPath, orphanedDocs);
			} else if (DESIGN_DOC_PATTERN.test(entry.name)) {
				orphanedDocs.push(fullPath);
			}
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code ?? "";
		if (!IGNORABLE_ERRORS.has(code)) throw error;
	}

	return orphanedDocs;
}

function main() {
	const orphanedDocs = findOrphanedDesignDocs();

	if (orphanedDocs.length > 0) {
		console.error(
			"❌ ERROR: Orphaned design docs found outside openspec/changes",
		);
		console.error("");
		console.error(
			"The following design doc(s) should be moved to openspec/changes/<change-id>/design.md:",
		);
		console.error("");

		for (const doc of orphanedDocs) {
			console.error(`  - ${doc}`);
		}

		console.error("");
		console.error("Per openspec/AGENTS.md line 50:");
		console.error(
			"Design docs MUST be moved (not copied) from docs/plans/ to openspec/changes/<id>/design.md",
		);
		console.error("");
		console.error("Action required:");
		console.error(
			"1. If this design doc was already moved to openspec/changes, DELETE this file:",
		);
		console.error("   rm <design-doc>");
		console.error("");
		console.error(
			"2. If this design doc has NOT been moved yet, MOVE it to the openspec change directory:",
		);
		console.error("   mv <design-doc> openspec/changes/<change-id>/design.md");
		console.error("");

		process.exit(1);
	}

	console.log("✓ No orphaned design docs found");
	process.exit(0);
}

main();
