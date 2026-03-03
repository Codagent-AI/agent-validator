import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

interface ReviewGate {
  reviewType: string;
  cli: string;
  durationS: number;
  violations: number;
  violationsFixed: number;
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

type TelemetryEntry = Omit<TokenStats, 'runsWithTelemetry'>;

interface RunBlock {
  timestamp: string;
  mode: string;
  linesAdded: number;
  linesRemoved: number;
  reviewGates: ReviewGate[];
  priorPassSkips: number;
  telemetry: TelemetryEntry[];
  end?: { status: string; failed: number };
}

interface GateStat {
  count: number;
  totalDuration: number;
  totalViolations: number;
  totalViolationsFixed: number;
}

interface CrossTab {
  cells: Map<string, Map<string, GateStat>>;
  cliTotals: Map<string, GateStat>;
  typeTotals: Map<string, GateStat>;
  grandTotal: GateStat;
  allTypes: string[];
  allClis: string[];
  per100: Map<string, { dur: number; diff: number }>;
}

function parseKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, key, value] of text.matchAll(/(\w+)=(\S+)/g))
    if (key && value) result[key] = value;
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
const parseDuration = (d: string): number => {
  const m = d.match(/^([\d.]+)(ms|s|m)?$/);
  const val = safeNum(m?.[1]);
  if (m?.[2] === 'ms') return val / 1000;
  if (m?.[2] === 'm') return val * 60;
  return val;
};

function getLogDir(cwd: string): string {
  try {
    const cfg = path.join(cwd, '.gauntlet', 'config.yml');
    const m = fs.readFileSync(cfg, 'utf-8').match(/^log_dir:\s*(.+)$/m);
    if (m?.[1]) return m[1].trim();
  } catch {}
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
  const gateId = body.match(/^(\S+)/)?.[1] ?? '';
  if (!gateId.startsWith('review:')) return;
  const kv = parseKeyValue(body);
  if (kv.cli) {
    current.reviewGates.push({
      reviewType: gateId.split(':').at(-1) ?? 'other',
      cli: kv.cli,
      durationS: parseDuration(kv.duration ?? '0s'),
      violations: safeNum(kv.violations),
      violationsFixed: 0,
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
  current.end = { status: kv.status ?? 'unknown', failed: safeNum(kv.failed) };
}

const emptyStat = (): GateStat => ({
  count: 0,
  totalDuration: 0,
  totalViolations: 0,
  totalViolationsFixed: 0,
});
function addGate(s: GateStat, g: ReviewGate): void {
  s.count++;
  s.totalDuration += g.durationS;
  s.totalViolations += g.violations;
  s.totalViolationsFixed += g.violationsFixed;
}
function getOrCreate<V>(map: Map<string, V>, key: string, init: () => V): V {
  if (!map.has(key)) map.set(key, init());
  return map.get(key) as V;
}

const REVIEW_TYPES = ['code-quality', 'task-compliance', 'artifact-review'];

type CrossTabAccum = Pick<
  CrossTab,
  'cells' | 'cliTotals' | 'typeTotals' | 'grandTotal' | 'per100'
>;
function accumulateBlock(block: RunBlock, a: CrossTabAccum): void {
  for (const g of block.reviewGates) {
    const inner = a.cells.get(g.reviewType) ?? new Map<string, GateStat>();
    a.cells.set(g.reviewType, inner);
    addGate(getOrCreate(inner, g.cli, emptyStat), g);
    addGate(getOrCreate(a.cliTotals, g.cli, emptyStat), g);
    addGate(getOrCreate(a.typeTotals, g.reviewType, emptyStat), g);
    addGate(a.grandTotal, g);
  }
  const diff = block.linesAdded + block.linesRemoved;
  if (diff <= 0) return;
  for (const cli of new Set(block.reviewGates.map((g) => g.cli))) {
    const dur = block.reviewGates
      .filter((g) => g.cli === cli)
      .reduce((s, g) => s + g.durationS, 0);
    const p = getOrCreate(a.per100, cli, () => ({ dur: 0, diff: 0 }));
    p.dur += dur;
    p.diff += diff;
  }
}

export function buildCrossTab(blocks: RunBlock[]): CrossTab {
  const a: CrossTabAccum = {
    cells: new Map(),
    cliTotals: new Map(),
    typeTotals: new Map(),
    per100: new Map(),
    grandTotal: emptyStat(),
  };
  for (const block of blocks) accumulateBlock(block, a);
  const allTypes = [
    ...REVIEW_TYPES.filter((t) => a.typeTotals.has(t)),
    ...[...a.typeTotals.keys()].filter((t) => !REVIEW_TYPES.includes(t)),
  ];
  return { ...a, allTypes, allClis: [...a.cliTotals.keys()] };
}

const emptyTokenStats = (adapter: string): TokenStats => ({
  adapter,
  inTokens: 0,
  cacheTokens: 0,
  outTokens: 0,
  thoughtTokens: 0,
  toolTokens: 0,
  apiRequests: 0,
  cacheRead: 0,
  cacheWrite: 0,
  runsWithTelemetry: 0,
});

function accumulateTelemetryEntry(
  t: TelemetryEntry,
  statsMap: Map<string, TokenStats>,
): void {
  const s = statsMap.get(t.adapter) ?? emptyTokenStats(t.adapter);
  statsMap.set(t.adapter, s);
  s.inTokens += t.inTokens;
  s.cacheTokens += t.cacheTokens;
  s.outTokens += t.outTokens;
  s.thoughtTokens += t.thoughtTokens;
  s.toolTokens += t.toolTokens;
  s.apiRequests += t.apiRequests;
  s.cacheRead += t.cacheRead;
  s.cacheWrite += t.cacheWrite;
}

export function aggregateTokenStats(blocks: RunBlock[]): TokenStats[] {
  const statsMap = new Map<string, TokenStats>();
  for (const block of blocks) {
    const adaptersInBlock = new Set(block.telemetry.map((t) => t.adapter));
    for (const t of block.telemetry) accumulateTelemetryEntry(t, statsMap);
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
const fmtType = (t: string): string => t.split('-').map(capitalize).join('-');

function formatCrossTable(
  title: string,
  rowLabels: string[],
  colLabels: string[],
  cell: (row: string, col: string) => string,
  rowTotal: (row: string) => string,
  colTotal: (col: string) => string,
  grandTotal: string,
): string[] {
  const rlW = Math.max(17, ...rowLabels.map((r) => fmtType(r).length)) + 2;
  const hdr =
    padRight('', rlW) +
    colLabels.map((c) => padRight(capitalize(c), 12)).join('') +
    'Total';
  const rows = rowLabels.map(
    (r) =>
      padRight(fmtType(r), rlW) +
      colLabels.map((c) => padRight(cell(r, c), 12)).join('') +
      rowTotal(r),
  );
  const totalRow =
    padRight('Total', rlW) +
    colLabels.map((c) => padRight(colTotal(c), 12)).join('') +
    grandTotal;
  return [title, hdr, ...rows, totalRow, ''];
}

function formatRunCounts(ct: CrossTab): string[] {
  return formatCrossTable(
    '=== Run Counts ===',
    ct.allTypes,
    ct.allClis,
    (t, c) => String(ct.cells.get(t)?.get(c)?.count ?? 0),
    (t) => String(ct.typeTotals.get(t)?.count ?? 0),
    (c) => String(ct.cliTotals.get(c)?.count ?? 0),
    String(ct.grandTotal.count),
  );
}

function formatTiming(ct: CrossTab): string[] {
  const avg = (s: GateStat | undefined): string =>
    s && s.count > 0 ? `${(s.totalDuration / s.count).toFixed(1)}s` : 'n/a';
  const lines = formatCrossTable(
    '=== Timing ===',
    ct.allTypes,
    ct.allClis,
    (t, c) => avg(ct.cells.get(t)?.get(c)),
    (t) => avg(ct.typeTotals.get(t)),
    (c) => avg(ct.cliTotals.get(c)),
    avg(ct.grandTotal),
  );
  const p100parts = ct.allClis
    .map((c) => {
      const p = ct.per100.get(c);
      return p && p.diff > 0
        ? `${c}=${((p.dur / p.diff) * 100).toFixed(1)}s`
        : '';
    })
    .filter(Boolean);
  if (p100parts.length > 0)
    lines.splice(
      lines.length - 1,
      0,
      `Per 100 diff lines (excl. zero-diff): ${p100parts.join('  ')}`,
    );
  return lines;
}

function formatViolations(ct: CrossTab): string[] {
  const avg = (s: GateStat | undefined): string =>
    s && s.count > 0 ? (s.totalViolations / s.count).toFixed(2) : 'n/a';
  return formatCrossTable(
    '=== Violations (avg per run) ===',
    ct.allTypes,
    ct.allClis,
    (t, c) => avg(ct.cells.get(t)?.get(c)),
    (t) => avg(ct.typeTotals.get(t)),
    (c) => avg(ct.cliTotals.get(c)),
    avg(ct.grandTotal),
  );
}
function formatViolationsFixed(ct: CrossTab): string[] {
  const avg = (s: GateStat | undefined): string =>
    s && s.count > 0 ? (s.totalViolationsFixed / s.count).toFixed(2) : 'n/a';
  return formatCrossTable(
    '=== Violations Fixed (avg per run) ===',
    ct.allTypes,
    ct.allClis,
    (t, c) => avg(ct.cells.get(t)?.get(c)),
    (t) => avg(ct.typeTotals.get(t)),
    (c) => avg(ct.cliTotals.get(c)),
    avg(ct.grandTotal),
  );
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

function formatTokenUsage(ts: TokenStats[], m: Map<string, number>): string[] {
  if (ts.length === 0)
    return ['=== Token Usage ===', 'No telemetry data found.', ''];
  return [
    '=== Token Usage ===',
    ...ts.flatMap((t) =>
      formatTokenEntry(t, m.get(t.adapter) ?? t.runsWithTelemetry),
    ),
  ];
}

function formatSummary(
  blocks: RunBlock[],
  ct: CrossTab,
  totalFixed: number,
): string[] {
  const total = blocks.filter((b) => b.end).length;
  return [
    '=== Summary ===',
    `Gauntlet rounds: ${total}`,
    `  Total runs:      ${ct.grandTotal.count}`,
    `  Total review issues fixed: ${totalFixed}`,
  ];
}
function computeViolationsFixed(blocks: RunBlock[]): void {
  blocks.slice(1).forEach((cur, j) => {
    for (const g of cur.reviewGates) {
      const p = blocks[j]?.reviewGates.find(
        (pg) => pg.reviewType === g.reviewType && pg.cli === g.cli,
      );
      if (p && p.violations > g.violations)
        g.violationsFixed = p.violations - g.violations;
    }
  });
}
export function formatAuditReport(blocks: RunBlock[], date: string): string {
  if (blocks.length === 0)
    return `Review Execution Audit — ${date}\n\nNo gauntlet runs found for this date.`;
  computeViolationsFixed(blocks);
  const ct = buildCrossTab(blocks);
  const tokenStats = aggregateTokenStats(blocks);
  const cliBlockCount = new Map<string, number>();
  for (const block of blocks) {
    for (const cli of new Set(block.reviewGates.map((g) => g.cli)))
      cliBlockCount.set(cli, (cliBlockCount.get(cli) ?? 0) + 1);
  }
  return [
    `Review Execution Audit — ${date}`,
    '',
    ...formatRunCounts(ct),
    ...formatTiming(ct),
    ...formatViolations(ct),
    ...formatViolationsFixed(ct),
    ...formatTokenUsage(tokenStats, cliBlockCount),
    ...formatSummary(blocks, ct, ct.grandTotal.totalViolationsFixed),
  ].join('\n');
}

function todayLocalDate(): string {
  const now = new Date();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const dy = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mo}-${dy}`;
}

async function readBlocks(
  filePath: string,
  matchDate: (d: string) => boolean,
): Promise<RunBlock[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  const blocks: RunBlock[] = [];
  let current: RunBlock | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const ts = parseTimestamp(line);
    if (!matchDate(ts.slice(0, 10))) continue;
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
export async function main(date?: string, since?: string): Promise<void> {
  const cwd = process.cwd();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (date && !dateRe.test(date)) {
    console.error('Invalid --date. Expected YYYY-MM-DD');
    process.exit(1);
  }
  if (since && !dateRe.test(since)) {
    console.error('Invalid --since. Expected YYYY-MM-DD');
    process.exit(1);
  }
  const debugLogPath = path.join(cwd, getLogDir(cwd), '.debug.log');
  if (!fs.existsSync(debugLogPath)) {
    console.log(`No debug log found. (looked in ${getLogDir(cwd)}/.debug.log)`);
    process.exit(0);
  }
  let matchDate: (d: string) => boolean;
  let label: string;
  if (since) {
    matchDate = (d) => d >= since;
    label = `${since} – ${todayLocalDate()}`;
  } else {
    const targetDate = date ?? todayLocalDate();
    matchDate = (d) => d === targetDate;
    label = targetDate;
  }
  const blocks = await readBlocks(debugLogPath, matchDate);
  console.log(formatAuditReport(blocks, label));
}

const isDirectRun =
  (import.meta.url === `file://${process.argv[1]}` ||
    (typeof Bun !== 'undefined' && import.meta.url === `file://${Bun.main}`)) &&
  (process.argv[1]?.endsWith('review-audit.ts') ||
    process.argv[1]?.endsWith('review-audit.js'));
if (isDirectRun) void main();
