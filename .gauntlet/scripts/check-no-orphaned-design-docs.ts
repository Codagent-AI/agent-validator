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

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function findOrphanedDesignDocs(dir: string = ".", orphanedDocs: string[] = []): string[] {
    // Skip excluded directories
    const dirName = dir.split("/").pop() || "";
    if (dirName === "node_modules" || dirName === ".git" || dir.includes("/node_modules/") || dir.includes("/.git/")) {
        return orphanedDocs;
    }

    // Skip openspec/changes - that's the legitimate location
    if (dir.startsWith("./openspec/changes") || dir.startsWith("openspec/changes")) {
        return orphanedDocs;
    }

    try {
        const entries = readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = join(dir, entry.name);

            if (entry.isDirectory()) {
                findOrphanedDesignDocs(fullPath, orphanedDocs);
            } else if (entry.isFile() && (entry.name === "design.md" || entry.name.endsWith("-design.md"))) {
                orphanedDocs.push(fullPath);
            }
        }
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "EACCES" && err.code !== "ENOENT") {
            throw error;
        }
    }

    return orphanedDocs;
}

function main() {
    const orphanedDocs = findOrphanedDesignDocs();

    if (orphanedDocs.length > 0) {
        console.error("❌ ERROR: Orphaned design docs found outside openspec/changes");
        console.error("");
        console.error("The following design doc(s) should be moved to openspec/changes/<change-id>/design.md:");
        console.error("");

        for (const doc of orphanedDocs) {
            console.error(`  - ${doc}`);
        }

        console.error("");
        console.error("Per openspec/AGENTS.md line 50:");
        console.error("Design docs MUST be moved (not copied) from docs/plans/ to openspec/changes/<id>/design.md");
        console.error("");
        console.error("Action required:");
        console.error("1. If this design doc was already moved to openspec/changes, DELETE this file:");
        console.error(`   rm ${orphanedDocs[0]}`);
        console.error("");
        console.error("2. If this design doc has NOT been moved yet, MOVE it to the openspec change directory:");
        console.error("   mv <design-doc> openspec/changes/<change-id>/design.md");
        console.error("");

        process.exit(1);
    }

    console.log("✓ No orphaned design docs found");
    process.exit(0);
}

main();
