import fs from 'node:fs';
import path from 'node:path';

interface ReviewGate {
  reviewType: string;
  cli: string;
  durationS: number;
  violations: number;
}

interface TelemetryEntry {
  adapter: string;
  inTokens: number;
  cacheTokens: number;
  outTokens: number;
  thoughtTokens: number;
  toolTokens: number;
  apiRequests: number;
  cacheRead: number;
  cacheWrite: number;
}

interface RunEndInfo {
  status: string;
  fixed: number;
  skipped: number;
  failed: number;
}

interface RunBlock {
  timestamp: string;
  mode: string;
  linesAdded: number;
  linesRemoved: number;
  reviewGates: ReviewGate[];
  priorPassSkips: number;
  telemetry: TelemetryEntry[];
  end?: RunEndInfo;
}

interface ReviewerStats {
  cli: string;
  counts: Record<string, number>;
  totalRuns: number;
  totalDuration: number;
  totalViolations: number;
  minViolations: number;
  maxViolations: number;
  per100Duration: number;
  per100Diff: number;
  runsWithTelemetry: number;
}

interface TokenStats {
  adapter: string;
  inTokens: number;
  cacheTokens: number;
  outTokens: number;
  thoughtTokens: number;
  toolTokens: number;
  apiRequests: number;
  cacheRead: number;
  cacheWrite: number;
  runsWithTelemetry: number;
}

function parseKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/(\w+)=(\S+)/g)) {
    const key = match[1];
    const value = match[2];
    if (key && value) result[key] = value;
  }
  return result;
}
const parseTimestamp = (line: string): string =>
  line.match(/^\[([^\]]+)\]/)?.[1] ?? '';
const parseEventType = (line: string): string =>
  line.match(/^\[[^\]]+\]\s+(\S+)/)?.[1] ?? '';
const parseEventBody = (line: string): string =>
  line.match(/^\[[^\]]+\]\s+\S+\s*(.*)/)?.[1] ?? '';
const safeNum = (v: string | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isNaN(n) ? 0 : n;
};
const extractReviewType = (gateId: string): string => {
  const parts = gateId.split(':');
  return parts[parts.length - 1] ?? 'other';
};
const parseDuration = (d: string): number => {
  const m = d.match(/^([\d.]+)(ms|s|m)?$/);
  const val = safeNum(m?.[1]);
  if (m?.[2] === 'ms') return val / 1000;
  if (m?.[2] === 'm') return val * 60;
  return val;
};

function getLogDir(cwd: string): string {
  const configPath = path.join(cwd, '.gauntlet', 'config.yml');
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const match = content.match(/^log_dir:\s*(.+)$/m);
    if (match?.[1]) return match[1].trim();
  } catch {
    // Config not found — use default
  }
  return 'gauntlet_logs';
}

function handleRunStart(ts: string, body: string): RunBlock {
  const kv = parseKeyValue(body);
  return {
    timestamp: ts,
    mode: kv.mode ?? 'unknown',
    linesAdded: safeNum(kv.lines_added),
    linesRemoved: safeNum(kv.lines_removed),
    reviewGates: [],
    priorPassSkips: 0,
    telemetry: [],
  };
}
function handleGateResult(current: RunBlock, body: string): void {
  const gateIdMatch = body.match(/^(\S+)/);
  const gateId = gateIdMatch?.[1] ?? '';
  if (!gateId.startsWith('review:')) return;
  const kv = parseKeyValue(body);
  if (kv.cli) {
    current.reviewGates.push({
      reviewType: extractReviewType(gateId),
      cli: kv.cli,
      durationS: parseDuration(kv.duration ?? '0s'),
      violations: safeNum(kv.violations),
    });
  } else {
    current.priorPassSkips++;
  }
}
function handleTelemetry(current: RunBlock, body: string): void {
  const kv = parseKeyValue(body);
  if (!kv.adapter) return;
  current.telemetry.push({
    adapter: kv.adapter,
    inTokens: safeNum(kv.in),
    cacheTokens: safeNum(kv.cache),
    outTokens: safeNum(kv.out),
    thoughtTokens: safeNum(kv.thought),
    toolTokens: safeNum(kv.tool),
    apiRequests: safeNum(kv.api_requests),
    cacheRead: safeNum(kv.cacheRead),
    cacheWrite: safeNum(kv.cacheWrite),
  });
}
function handleRunEnd(current: RunBlock, body: string): void {
  const kv = parseKeyValue(body);
  current.end = {
    status: kv.status ?? 'unknown',
    fixed: safeNum(kv.fixed),
    skipped: safeNum(kv.skipped),
    failed: safeNum(kv.failed),
  };
}

export function buildRunBlocks(content: string, date: string): RunBlock[] {
  const lines = content.split('\n').filter((l) => l.trim());
  const blocks: RunBlock[] = [];
  let current: RunBlock | null = null;
  for (const line of lines) {
    const ts = parseTimestamp(line);
    if (!ts.startsWith(date)) continue;
    const event = parseEventType(line);
    const body = parseEventBody(line);
    if (event === 'RUN_START') {
      current = handleRunStart(ts, body);
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    if (event === 'GATE_RESULT') handleGateResult(current, body);
    else if (event === 'TELEMETRY') handleTelemetry(current, body);
    else if (event === 'RUN_END') handleRunEnd(current, body);
  }
  return blocks;
}

function getOrCreateReviewerStats(
  statsMap: Map<string, ReviewerStats>,
  cli: string,
): ReviewerStats {
  let stats = statsMap.get(cli);
  if (!stats) {
    stats = {
      cli,
      counts: {},
      totalRuns: 0,
      totalDuration: 0,
      totalViolations: 0,
      minViolations: Infinity,
      maxViolations: -Infinity,
      per100Duration: 0,
      per100Diff: 0,
      runsWithTelemetry: 0,
    };
    statsMap.set(cli, stats);
  }
  return stats;
}
function accumulateGateStats(
  blocks: RunBlock[],
  statsMap: Map<string, ReviewerStats>,
): void {
  for (const block of blocks) {
    const adapterSet = new Set(block.telemetry.map((t) => t.adapter));
    for (const gate of block.reviewGates) {
      const s = getOrCreateReviewerStats(statsMap, gate.cli);
      s.totalRuns++;
      s.counts[gate.reviewType] = (s.counts[gate.reviewType] ?? 0) + 1;
      s.totalDuration += gate.durationS;
      s.totalViolations += gate.violations;
      if (gate.violations < s.minViolations) s.minViolations = gate.violations;
      if (gate.violations > s.maxViolations) s.maxViolations = gate.violations;
      if (adapterSet.has(gate.cli)) s.runsWithTelemetry++;
    }
  }
}
function accumulatePer100Stats(
  blocks: RunBlock[],
  statsMap: Map<string, ReviewerStats>,
): void {
  for (const block of blocks) {
    const totalDiff = block.linesAdded + block.linesRemoved;
    if (totalDiff === 0) continue;
    const clisInBlock = new Set(block.reviewGates.map((g) => g.cli));
    for (const cli of clisInBlock) {
      const s = getOrCreateReviewerStats(statsMap, cli);
      const dur = block.reviewGates
        .filter((g) => g.cli === cli)
        .reduce((sum, g) => sum + g.durationS, 0);
      s.per100Duration += dur;
      s.per100Diff += totalDiff;
    }
  }
}
export function aggregateReviewerStats(blocks: RunBlock[]): ReviewerStats[] {
  const statsMap = new Map<string, ReviewerStats>();
  accumulateGateStats(blocks, statsMap);
  accumulatePer100Stats(blocks, statsMap);
  for (const s of statsMap.values()) {
    if (s.minViolations === Infinity) s.minViolations = 0;
    if (s.maxViolations === -Infinity) s.maxViolations = 0;
  }
  return Array.from(statsMap.values());
}
export function aggregateTokenStats(blocks: RunBlock[]): TokenStats[] {
  const statsMap = new Map<string, TokenStats>();
  for (const block of blocks) {
    const adaptersInBlock = new Set(block.telemetry.map((t) => t.adapter));
    for (const t of block.telemetry) {
      let s = statsMap.get(t.adapter);
      if (!s) {
        s = {
          adapter: t.adapter,
          inTokens: 0,
          cacheTokens: 0,
          outTokens: 0,
          thoughtTokens: 0,
          toolTokens: 0,
          apiRequests: 0,
          cacheRead: 0,
          cacheWrite: 0,
          runsWithTelemetry: 0,
        };
        statsMap.set(t.adapter, s);
      }
      s.inTokens += t.inTokens;
      s.cacheTokens += t.cacheTokens;
      s.outTokens += t.outTokens;
      s.thoughtTokens += t.thoughtTokens;
      s.toolTokens += t.toolTokens;
      s.apiRequests += t.apiRequests;
      s.cacheRead += t.cacheRead;
      s.cacheWrite += t.cacheWrite;
    }
    for (const adapter of adaptersInBlock) {
      const s = statsMap.get(adapter);
      if (s) s.runsWithTelemetry++;
    }
  }
  return Array.from(statsMap.values());
}

const formatNum = (n: number): string => n.toLocaleString('en-US');
const padRight = (s: string, w: number): string =>
  s + ' '.repeat(Math.max(0, w - s.length));
const padLeft = (s: string, w: number): string =>
  ' '.repeat(Math.max(0, w - s.length)) + s;
const capitalize = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);
const KNOWN_REVIEW_TYPES = [
  'code-quality',
  'task-compliance',
  'artifact-review',
];

function formatRunCounts(reviewerStats: ReviewerStats[]): string[] {
  const allTypes = new Set<string>();
  for (const s of reviewerStats) {
    for (const t of Object.keys(s.counts)) allTypes.add(t);
  }
  const displayTypes = [
    ...KNOWN_REVIEW_TYPES.filter((t) => allTypes.has(t)),
    ...[...allTypes].filter((t) => !KNOWN_REVIEW_TYPES.includes(t)),
  ];
  const rc = 10;
  const tc = 17;
  let header = padRight('Reviewer', rc);
  for (const t of displayTypes) {
    header += padRight(t.split('-').map(capitalize).join('-'), tc);
  }
  header += 'Total';
  const rows = reviewerStats.map((s) => {
    let row = padRight(s.cli, rc);
    for (const t of displayTypes) row += padRight(String(s.counts[t] ?? 0), tc);
    return row + String(s.totalRuns);
  });
  return ['=== Run Counts ===', header, ...rows, ''];
}

function formatTiming(reviewerStats: ReviewerStats[]): string[] {
  const rc = 10;
  const hdr =
    padRight('Reviewer', rc) +
    padRight('Runs', 6) +
    padRight('Avg Duration', 14) +
    'Per 100 Diff Lines*';
  const rows = reviewerStats.map((s) => {
    const avg = s.totalRuns > 0 ? s.totalDuration / s.totalRuns : 0;
    const p100 =
      s.per100Diff > 0
        ? `${((s.per100Duration / s.per100Diff) * 100).toFixed(1)}s`
        : 'n/a';
    return (
      padRight(s.cli, rc) +
      padRight(String(s.totalRuns), 6) +
      padRight(`${avg.toFixed(1)}s`, 14) +
      p100
    );
  });
  return [
    '=== Timing ===',
    hdr,
    ...rows,
    '* excludes zero-diff runs; weighted by total diff lines',
    '',
  ];
}

function formatViolations(reviewerStats: ReviewerStats[]): string[] {
  const rc = 10;
  const hdr =
    padRight('Reviewer', rc) +
    padRight('Total', 8) +
    padRight('Avg/Run', 10) +
    'Range';
  const rows = reviewerStats.map((s) => {
    const avg = s.totalRuns > 0 ? s.totalViolations / s.totalRuns : 0;
    return (
      padRight(s.cli, rc) +
      padRight(String(s.totalViolations), 8) +
      padRight(avg.toFixed(2), 10) +
      `${s.minViolations}–${s.maxViolations}`
    );
  });
  return ['=== Violations ===', hdr, ...rows, ''];
}

function formatTokenEntry(t: TokenStats, totalRuns: number): string[] {
  const out: string[] = [
    `${capitalize(t.adapter)} (${t.runsWithTelemetry} of ${totalRuns} runs had telemetry):`,
  ];
  if (t.inTokens > 0 || t.cacheTokens > 0) {
    const total = t.inTokens + t.cacheTokens;
    out.push(
      `  Input:        ${padLeft(formatNum(total), 12)}   (non-cached: ${formatNum(t.inTokens)} | cached: ${formatNum(t.cacheTokens)})`,
    );
  }
  if (t.outTokens > 0)
    out.push(`  Output:       ${padLeft(formatNum(t.outTokens), 12)}`);
  if (t.thoughtTokens > 0)
    out.push(`  Thinking:     ${padLeft(formatNum(t.thoughtTokens), 12)}`);
  if (t.toolTokens > 0)
    out.push(`  Tool tokens:  ${padLeft(formatNum(t.toolTokens), 12)}`);
  if (t.cacheRead > 0 || t.cacheWrite > 0) {
    out.push(`  Cache reads:  ${padLeft(formatNum(t.cacheRead), 12)}`);
    out.push(`  Cache writes: ${padLeft(formatNum(t.cacheWrite), 12)}`);
  }
  if (t.apiRequests > 0) {
    const avg =
      t.runsWithTelemetry > 0
        ? (t.apiRequests / t.runsWithTelemetry).toFixed(1)
        : '?';
    out.push(
      `  API requests: ${padLeft(formatNum(t.apiRequests), 12)}    (avg ${avg}/run)`,
    );
  }
  out.push('');
  return out;
}

function formatTokenUsage(
  tokenStats: TokenStats[],
  cliRunMap: Map<string, number>,
): string[] {
  if (tokenStats.length === 0)
    return ['=== Token Usage ===', 'No telemetry data found.', ''];
  const lines: string[] = ['=== Token Usage ==='];
  for (const t of tokenStats) {
    lines.push(
      ...formatTokenEntry(t, cliRunMap.get(t.adapter) ?? t.runsWithTelemetry),
    );
  }
  return lines;
}

function formatFixSkip(blocks: RunBlock[]): string[] {
  const withEnd = blocks.filter((b) => b.end);
  const total = withEnd.length;
  const passed = withEnd.filter((b) => b.end?.status === 'pass').length;
  const fixed = withEnd.reduce((s, b) => s + (b.end?.fixed ?? 0), 0);
  const skipped = withEnd.reduce((s, b) => s + (b.end?.skipped ?? 0), 0);
  const failed = withEnd.reduce((s, b) => s + (b.end?.failed ?? 0), 0);
  const priorPass = blocks.reduce((s, b) => s + b.priorPassSkips, 0);
  const lines = [
    '=== Fix / Skip ===',
    `Gauntlet runs: ${total} total  (${passed} passed, ${total - passed} failed)`,
    `  Violations fixed:   ${fixed}`,
    `  Violations skipped: ${skipped}`,
    `  Gates failed:       ${failed}`,
    `  Review gates skipped (prior pass): ${priorPass}`,
  ];
  const totalFixedSkipped = fixed + skipped;
  if (totalFixedSkipped > 0) {
    const fp = ((fixed / totalFixedSkipped) * 100).toFixed(1);
    const sp = ((skipped / totalFixedSkipped) * 100).toFixed(1);
    lines.push(`  (fixed: ${fp}% | skipped: ${sp}% of fixed+skipped)`);
  }
  return lines;
}

export function formatAuditReport(blocks: RunBlock[], date: string): string {
  if (blocks.length === 0)
    return `Review Execution Audit — ${date}\n\nNo gauntlet runs found for this date.`;
  const reviewerStats = aggregateReviewerStats(blocks);
  const tokenStats = aggregateTokenStats(blocks);
  const cliRunMap = new Map(reviewerStats.map((s) => [s.cli, s.totalRuns]));
  return [
    `Review Execution Audit — ${date}`,
    '',
    ...formatRunCounts(reviewerStats),
    ...formatTiming(reviewerStats),
    ...formatViolations(reviewerStats),
    ...formatTokenUsage(tokenStats, cliRunMap),
    ...formatFixSkip(blocks),
  ].join('\n');
}

function todayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

export function main(date?: string): void {
  const cwd = process.cwd();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Invalid --date. Expected YYYY-MM-DD');
    process.exit(1);
  }
  const targetDate = date ?? todayLocalDate();
  const debugLogPath = path.join(cwd, getLogDir(cwd), '.debug.log');
  if (!fs.existsSync(debugLogPath)) {
    console.log(`No debug log found. (looked in ${getLogDir(cwd)}/.debug.log)`);
    process.exit(0);
  }
  const content = fs.readFileSync(debugLogPath, 'utf-8');
  console.log(
    formatAuditReport(buildRunBlocks(content, targetDate), targetDate),
  );
}

const isDirectRun =
  (import.meta.url === `file://${process.argv[1]}` ||
    (typeof Bun !== 'undefined' && import.meta.url === `file://${Bun.main}`)) &&
  (process.argv[1]?.endsWith('review-audit.ts') ||
    process.argv[1]?.endsWith('review-audit.js'));
if (isDirectRun) main();
