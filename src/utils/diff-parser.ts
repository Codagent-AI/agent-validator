export type DiffFileRange = Set<number>;

/**
 * Parses a unified diff string into a map of filenames to sets of valid line numbers.
 * Valid line numbers are those that appear in the diff as added or modified lines.
 */
export function parseDiff(diff: string): Map<string, DiffFileRange> {
	return new DiffParser().parse(diff);
}

class DiffParser {
	private fileRanges = new Map<string, DiffFileRange>();
	private currentFile: string | null = null;
	private currentRanges: DiffFileRange | null = null;
	private currentLineNumber = 0;

	parse(diff: string): Map<string, DiffFileRange> {
		const lines = diff.split("\n");
		for (const line of lines) {
			this.processLine(line);
		}
		return this.fileRanges;
	}

	private processLine(line: string): void {
		if (this.tryParseFileHeader(line)) return;
		if (!this.currentFile || !this.currentRanges) return;
		if (this.tryParseHunkHeader(line)) return;
		this.processContentLine(line);
	}

	private tryParseFileHeader(line: string): boolean {
		if (!line.startsWith("diff --git")) return false;

		const result = parseFileHeader(line);
		if (result) {
			this.currentFile = result;
			this.currentRanges = new Set<number>();
			this.fileRanges.set(this.currentFile, this.currentRanges);
		} else {
			this.currentFile = null;
			this.currentRanges = null;
		}
		return true;
	}

	private tryParseHunkHeader(line: string): boolean {
		if (!line.startsWith("@@")) return false;

		const newLine = parseHunkHeader(line);
		if (newLine !== null) {
			this.currentLineNumber = newLine;
		}
		return true;
	}

	private processContentLine(line: string): void {
		if (!this.currentRanges) return;

		if (line.startsWith("+") && !line.startsWith("+++")) {
			this.currentRanges.add(this.currentLineNumber);
			this.currentLineNumber++;
		} else if (line.startsWith(" ")) {
			this.currentLineNumber++;
		}
	}
}

function parseFileHeader(line: string): string | null {
	const parts = line.split(" ");
	const targetPath = parts[3];
	if (parts.length >= 4 && targetPath) {
		const file = targetPath.startsWith("b/")
			? targetPath.substring(2)
			: targetPath;
		return file.startsWith(".git/") ? null : file;
	}
	return null;
}

function parseHunkHeader(line: string): number | null {
	const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
	return match?.[1] ? parseInt(match[1], 10) : null;
}

/**
 * Checks if a violation is valid based on the parsed diff ranges.
 */
export function isValidViolationLocation(
	file: string,
	line: number | undefined,
	diffRanges: Map<string, DiffFileRange> | undefined,
): boolean {
	// If no diff ranges provided (e.g. full file review), assume valid
	if (!diffRanges) return true;

	// Line is required for diff-scoped reviews
	if (line === undefined) return false;

	const validLines = diffRanges.get(file);
	if (!validLines) {
		// File not in diff
		return false;
	}

	return validLines.has(line);
}
