// ─── O(n) Line-Based OTel Block Scanner ──────────────────────────────────────
// Replaces regex-based block detection to avoid catastrophic backtracking
// on large outputs (~400KB+). Single-pass, string-aware brace tracking.

export interface ScanResult {
  metricBlocks: string[];
  logBlocks: string[];
  cleaned: string;
}

/** Strip backslash-escaped characters and quoted strings, then count net brace depth. */
export function countBraceChange(line: string): number {
  // Remove escaped characters, then quoted strings, leaving only structural chars
  const stripped = line
    .replace(/\\./g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/'[^']*'/g, '');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

/** Classify a captured block as metric, log, or neither. */
export function classifyBlock(block: string): 'metric' | 'log' | 'other' {
  if (
    block.includes('descriptor:') &&
    block.includes('dataPointType:') &&
    block.includes('dataPoints:')
  ) {
    return 'metric';
  }
  if (
    block.includes('resource:') &&
    /body:\s*['"]claude_code\.\w+['"]/.test(block)
  ) {
    return 'log';
  }
  return 'other';
}

/** Check if a line starts a brace block (standalone `{` or `[otel] {`). */
export function isBlockStart(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed === '{' || (trimmed.startsWith('[otel]') && trimmed.includes('{'))
  );
}

/** Route a completed block into the correct bucket. */
function routeBlock(
  blockLines: string[],
  metricBlocks: string[],
  logBlocks: string[],
  cleanedLines: string[],
): void {
  const block = blockLines.join('\n');
  const kind = classifyBlock(block);
  if (kind === 'metric') metricBlocks.push(block);
  else if (kind === 'log') logBlocks.push(block);
  else cleanedLines.push(...blockLines);
}

/**
 * Single-pass line scanner that extracts OTel metric and log blocks from raw output.
 * Returns classified blocks and cleaned output with OTel blocks removed.
 */
export function scanOtelBlocks(raw: string): ScanResult {
  const lines = raw.split('\n');
  const metricBlocks: string[] = [];
  const logBlocks: string[] = [];
  const cleanedLines: string[] = [];

  let blockLines: string[] | null = null;
  let depth = 0;

  for (const line of lines) {
    if (blockLines === null) {
      if (!isBlockStart(line)) {
        cleanedLines.push(line);
        continue;
      }
      blockLines = [line];
      depth = countBraceChange(line);
    } else {
      blockLines.push(line);
      depth += countBraceChange(line);
    }

    if (depth <= 0) {
      routeBlock(blockLines, metricBlocks, logBlocks, cleanedLines);
      blockLines = null;
      depth = 0;
    }
  }

  // If block never closed, restore lines to avoid data loss
  if (blockLines !== null) {
    cleanedLines.push(...blockLines);
  }

  return { metricBlocks, logBlocks, cleaned: cleanedLines.join('\n') };
}
