import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Compute SHA-256 checksum of all files in a skill directory.
 * Files are sorted by relative path for determinism.
 */
export async function computeSkillChecksum(skillDir: string): Promise<string> {
	const files = await collectFiles(skillDir);
	files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

	const hash = createHash("sha256");
	for (const file of files) {
		hash.update(file.relativePath);
		hash.update(file.content);
	}
	return hash.digest("hex");
}

/**
 * Compute checksum over gauntlet-specific hook entries only.
 */
export function computeHookChecksum(
	entries: Record<string, unknown>[],
): string {
	const gauntletEntries = entries.filter((entry) => isGauntletHookEntry(entry));
	const hash = createHash("sha256");
	hash.update(JSON.stringify(gauntletEntries));
	return hash.digest("hex");
}

/**
 * Compute the expected checksum for hook entries from their definitions.
 */
export function computeExpectedHookChecksum(
	hookEntries: Record<string, unknown>[],
): string {
	return computeHookChecksum(hookEntries);
}

/**
 * Returns true if the hook entry contains an "agent-gauntlet" command.
 */
export function isGauntletHookEntry(entry: Record<string, unknown>): boolean {
	if (
		typeof entry.command === "string" &&
		entry.command.startsWith("agent-gauntlet")
	) {
		return true;
	}
	const nested = entry.hooks as { command?: string }[] | undefined;
	if (Array.isArray(nested)) {
		return nested.some(
			(h) =>
				typeof h.command === "string" && h.command.startsWith("agent-gauntlet"),
		);
	}
	return false;
}

async function collectFiles(
	dir: string,
	baseDir?: string,
): Promise<{ relativePath: string; content: string }[]> {
	const base = baseDir ?? dir;
	const results: { relativePath: string; content: string }[] = [];
	const entries = await fs.readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await collectFiles(fullPath, base)));
		} else if (entry.isFile()) {
			const content = await fs.readFile(fullPath, "utf-8");
			results.push({ relativePath: path.relative(base, fullPath), content });
		}
	}
	return results;
}
