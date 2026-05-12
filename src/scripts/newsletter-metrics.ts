#!/usr/bin/env node
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: single-file script for direct Bun execution and easy newsletter data capture
/**
 * Newsletter Metrics Script
 *
 * Aggregates review execution metrics from Agent Validator debug logs across one
 * or more repositories. This is intended for field-data summaries where the
 * debug log is the source of truth.
 *
 * Notes:
 * - Historical debug logs record reviewer + CLI, but older versions do not
 *   record model on GATE_RESULT. This script infers model from current
 *   .validator/config.yml when possible and labels the provenance.
 * - "Fixed next cycle" is inferred by comparing violations for the same
 *   source/reviewer/CLI/model between consecutive observed validator cycles.
 * - Retained review JSON files are scanned separately for fixed/skipped/new
 *   statuses, but those files may only represent the most recent archived
 *   sessions rather than the entire debug-log window.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import YAML from 'yaml';

type OutputFormat = 'markdown' | 'json';

interface Args {
  sources: string[];
  since?: string;
  until?: string;
  days: number;
  format: OutputFormat;
  modelOverrides: Map<string, string>;
}

interface ModelResolution {
  model: string;
  source: 'log' | 'override' | 'current-config' | 'unknown';
}

interface ReviewEvent {
  source: string;
  sourcePath: string;
  timestamp: string;
  reviewer: string;
  cli: string;
  model: string;
  modelSource: ModelResolution['source'];
  status: string;
  durationS: number;
  violations: number;
}

interface CycleCombo {
  source: string;
  reviewer: string;
  cli: string;
  model: string;
  modelSource: ModelResolution['source'];
  violations: number;
  durationS: number;
  statuses: string[];
  executions: number;
}

interface RunCycle {
  source: string;
  timestamp: string;
  mode: string;
  linesAdded: number;
  linesRemoved: number;
  hasLineStats: boolean;
  fixed: number;
  skipped: number;
  events: ReviewEvent[];
  skippedReviewResults: number;
}

interface SourceMetrics {
  source: string;
  path: string;
  debugLogPath?: string;
  configPath?: string;
  start?: string;
  end?: string;
  cycles: number;
  cyclesWithLineStats: number;
  cyclesMissingLineStats: number;
  linesAdded: number;
  linesRemoved: number;
  issuesFound: number;
  issuesFoundWithLineStats: number;
  fixedRunEnd: number;
  skippedRunEnd: number;
  fixedRunEndWithLineStats: number;
  skippedRunEndWithLineStats: number;
  reviewExecutions: number;
  skippedReviewResults: number;
  modelSources: Record<string, number>;
}

interface RateSummary {
  cycles: number;
  cyclesWithLineStats: number;
  cyclesMissingLineStats: number;
  linesAdded: number;
  linesRemoved: number;
  editedLines: number;
  issuesFound: number;
  issuesFoundWithLineStats: number;
  fixedNextCycle: number;
  fixedNextCycleWithLineStats: number;
  fixedRunEnd: number;
  skippedRunEnd: number;
  fixedRunEndWithLineStats: number;
  skippedRunEndWithLineStats: number;
  approxFixedNotSkipped: number;
  approxFixedNotSkippedWithLineStats: number;
  issuesFoundPerKEditedLines: number | null;
  approxFixedNotSkippedPerKEditedLines: number | null;
  fixedRunEndPerKEditedLines: number | null;
}

interface JsonReviewStats {
  count: number;
  newCount: number;
  fixedCount: number;
  skippedCount: number;
}

interface ConfigModels {
  configPath?: string;
  adapterModels: Map<string, string>;
  reviewModels: Map<string, string>;
  knownReviewers: Set<string>;
}

interface ComboStats {
  source: string;
  reviewer: string;
  cli: string;
  model: string;
  modelSources: Record<string, number>;
  executions: number;
  cycles: number;
  pass: number;
  fail: number;
  error: number;
  issuesFound: number;
  issuesFoundWithLineStats: number;
  fixedNextCycle: number;
  fixedNextCycleWithLineStats: number;
  durationS: number;
  jsonReviews: number;
  jsonNew: number;
  jsonFixed: number;
  jsonSkipped: number;
}

interface MetricsReport {
  window: {
    since: string;
    until: string;
    days: number;
    inferredFromLogs: boolean;
  };
  summary: RateSummary;
  sources: SourceMetrics[];
  bySource: ComboStats[];
  combined: ComboStats[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, key, value] of text.matchAll(/(\w+)=(\S+)/g)) {
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

function safeNum(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseDurationS(value: string | undefined): number {
  const match = value?.match(/^([\d.]+)(ms|s|m)?$/);
  if (!match) return 0;
  const n = safeNum(match[1]);
  if (match[2] === 'ms') return n / 1000;
  if (match[2] === 'm') return n * 60;
  return n;
}

function localDate(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function expandHome(input: string): string {
  if (input === '~') return process.env.HOME ?? input;
  if (input.startsWith('~/'))
    return path.join(process.env.HOME ?? '~', input.slice(2));
  return input;
}

function sourceName(sourcePath: string): string {
  return path.resolve(sourcePath);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compact CLI parser keeps this standalone script dependency-free
function parseArgs(argv: string[]): Args {
  const args: Args = {
    sources: [],
    days: 30,
    format: 'markdown',
    modelOverrides: new Map(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--since') {
      args.since = argv[++i];
    } else if (arg === '--until') {
      args.until = argv[++i];
    } else if (arg === '--days') {
      args.days = Number(argv[++i] ?? 30);
    } else if (arg === '--format') {
      const format = argv[++i] as OutputFormat | undefined;
      if (format !== 'markdown' && format !== 'json') {
        throw new Error('Invalid --format. Expected markdown or json.');
      }
      args.format = format;
    } else if (arg === '--model') {
      const value = argv[++i] ?? '';
      const eq = value.indexOf('=');
      if (eq <= 0) {
        throw new Error('Invalid --model. Expected [source:]cli=model.');
      }
      args.modelOverrides.set(value.slice(0, eq), value.slice(eq + 1));
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      args.sources.push(expandHome(arg));
    }
  }

  if (!Number.isFinite(args.days) || args.days < 1) {
    throw new Error('Invalid --days. Expected a positive number.');
  }
  if (args.since && !DATE_RE.test(args.since)) {
    throw new Error('Invalid --since. Expected YYYY-MM-DD.');
  }
  if (args.until && !DATE_RE.test(args.until)) {
    throw new Error('Invalid --until. Expected YYYY-MM-DD.');
  }
  if (args.sources.length === 0) {
    args.sources = [process.cwd(), '~/codagent/agent-runner'].map(expandHome);
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: bun src/scripts/newsletter-metrics.ts [options] [repo...]

Options:
  --since YYYY-MM-DD       Start date. Defaults to latest log date minus --days.
  --until YYYY-MM-DD       End date. Defaults to latest log date.
  --days N                 Lookback window when --since is omitted. Default: 30.
  --format markdown|json   Output format. Default: markdown.
  --model KEY=MODEL        Override model inference. KEY is cli or source:cli.

Default repos:
  current working directory
  ~/codagent/agent-runner

Examples:
  bun src/scripts/newsletter-metrics.ts
  bun src/scripts/newsletter-metrics.ts --since 2026-04-01 --format json
  bun src/scripts/newsletter-metrics.ts --model agent-validator:github-copilot=claude-sonnet-4.6
`);
}

function readYamlFile(filePath: string): unknown {
  return YAML.parse(fs.readFileSync(filePath, 'utf-8'));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: config model inference handles inline reviews and frontmatter in one place
function loadConfigModels(repoPath: string): ConfigModels {
  const configPath = path.join(repoPath, '.validator', 'config.yml');
  const adapterModels = new Map<string, string>();
  const reviewModels = new Map<string, string>();
  const knownReviewers = new Set<string>();
  if (!fs.existsSync(configPath))
    return { adapterModels, reviewModels, knownReviewers };

  const config = asRecord(readYamlFile(configPath));
  const cli = asRecord(config.cli);
  const adapters = asRecord(cli.adapters);
  for (const [name, raw] of Object.entries(adapters)) {
    const model = asString(asRecord(raw).model);
    if (model) adapterModels.set(name, model);
  }

  const entryPoints = Array.isArray(config.entry_points)
    ? config.entry_points
    : [];
  for (const entryPoint of entryPoints) {
    const reviews = asRecord(entryPoint).reviews;
    if (!Array.isArray(reviews)) continue;
    for (const item of reviews) {
      if (typeof item === 'string') {
        knownReviewers.add(item);
        continue;
      }
      const reviewRecord = asRecord(item);
      for (const [reviewer, rawReview] of Object.entries(reviewRecord)) {
        knownReviewers.add(reviewer);
        const model = asString(asRecord(rawReview).model);
        if (model) reviewModels.set(reviewer, model);
      }
    }
  }

  const reviewsDir = path.join(repoPath, '.validator', 'reviews');
  if (fs.existsSync(reviewsDir)) {
    for (const entry of fs.readdirSync(reviewsDir)) {
      if (!entry.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(reviewsDir, entry), 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      knownReviewers.add(path.basename(entry, '.md'));
      if (!match) continue;
      const frontmatter = asRecord(YAML.parse(match[1] ?? ''));
      const model = asString(frontmatter.model);
      if (model) reviewModels.set(path.basename(entry, '.md'), model);
    }
  }

  return { configPath, adapterModels, reviewModels, knownReviewers };
}

function resolveModel(
  repoName: string,
  cli: string,
  reviewer: string,
  configModels: ReturnType<typeof loadConfigModels>,
  overrides: Map<string, string>,
  logModel?: string,
): ModelResolution {
  if (logModel) return { model: logModel, source: 'log' };
  const sourceOverride =
    overrides.get(`${repoName}:${cli}`) ??
    overrides.get(`${path.basename(repoName)}:${cli}`);
  if (sourceOverride) return { model: sourceOverride, source: 'override' };
  const cliOverride = overrides.get(cli);
  if (cliOverride) return { model: cliOverride, source: 'override' };
  const adapterModel = configModels.adapterModels.get(cli);
  if (adapterModel) return { model: adapterModel, source: 'current-config' };
  const reviewModel = configModels.reviewModels.get(reviewer);
  if (reviewModel) return { model: reviewModel, source: 'current-config' };
  return { model: 'unknown', source: 'unknown' };
}

function parseReviewer(gateId: string): string {
  return gateId.split(':').at(-1) ?? 'unknown';
}

function comboKey(
  parts: Pick<ReviewEvent, 'source' | 'reviewer' | 'cli' | 'model'>,
): string {
  return [parts.source, parts.reviewer, parts.cli, parts.model].join('\t');
}

function initComboStats(combo: {
  source: string;
  reviewer: string;
  cli: string;
  model: string;
}): ComboStats {
  return {
    ...combo,
    modelSources: {},
    executions: 0,
    cycles: 0,
    pass: 0,
    fail: 0,
    error: 0,
    issuesFound: 0,
    issuesFoundWithLineStats: 0,
    fixedNextCycle: 0,
    fixedNextCycleWithLineStats: 0,
    durationS: 0,
    jsonReviews: 0,
    jsonNew: 0,
    jsonFixed: 0,
    jsonSkipped: 0,
  };
}

function addModelSource(target: Record<string, number>, source: string): void {
  target[source] = (target[source] ?? 0) + 1;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: stream parser has several event branches by design
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: keeping event parsing together makes log-state handling easier to audit
async function parseDebugLog(
  repoPath: string,
  since: string,
  until: string,
  overrides: Map<string, string>,
): Promise<{ cycles: RunCycle[]; metrics: SourceMetrics }> {
  const name = sourceName(repoPath);
  const configModels = loadConfigModels(repoPath);
  const logDir = path.join(repoPath, 'validator_logs');
  const debugLogPath = path.join(logDir, '.debug.log');
  const metrics: SourceMetrics = {
    source: name,
    path: repoPath,
    debugLogPath: fs.existsSync(debugLogPath) ? debugLogPath : undefined,
    configPath: configModels.configPath,
    cycles: 0,
    cyclesWithLineStats: 0,
    cyclesMissingLineStats: 0,
    linesAdded: 0,
    linesRemoved: 0,
    issuesFound: 0,
    issuesFoundWithLineStats: 0,
    fixedRunEnd: 0,
    skippedRunEnd: 0,
    fixedRunEndWithLineStats: 0,
    skippedRunEndWithLineStats: 0,
    reviewExecutions: 0,
    skippedReviewResults: 0,
    modelSources: {},
  };

  if (!fs.existsSync(debugLogPath)) return { cycles: [], metrics };

  const cycles: RunCycle[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(debugLogPath),
  });
  let current: RunCycle | null = null;
  const pendingTelemetryModels = new Map<string, string>();

  for await (const line of rl) {
    if (!line.trim()) continue;
    const ts = parseTimestamp(line);
    const day = localDate(ts);
    const event = parseEventType(line);
    const body = parseEventBody(line);

    if (event === 'RUN_START') {
      pendingTelemetryModels.clear();
      const kv = parseKeyValue(body);
      const hasLineStats =
        kv.lines_added !== undefined || kv.lines_removed !== undefined;
      current =
        day >= since && day <= until
          ? {
              source: name,
              timestamp: ts,
              mode: kv.mode ?? 'unknown',
              linesAdded: safeNum(kv.lines_added),
              linesRemoved: safeNum(kv.lines_removed),
              hasLineStats,
              fixed: 0,
              skipped: 0,
              events: [],
              skippedReviewResults: 0,
            }
          : null;
      if (current) cycles.push(current);
      continue;
    }
    if (event === 'RUN_END') {
      if (current) {
        const kv = parseKeyValue(body);
        current.fixed = safeNum(kv.fixed);
        current.skipped = safeNum(kv.skipped);
      }
      pendingTelemetryModels.clear();
      continue;
    }

    if (!current) continue;
    if (event === 'TELEMETRY') {
      const kv = parseKeyValue(body);
      if (kv.adapter && kv.model)
        pendingTelemetryModels.set(kv.adapter, kv.model);
      continue;
    }
    if (event !== 'GATE_RESULT') continue;

    const gateId = body.match(/^(\S+)/)?.[1] ?? '';
    if (!gateId.startsWith('review:')) continue;

    const kv = parseKeyValue(body);
    if (!kv.cli) {
      current.skippedReviewResults++;
      continue;
    }

    const reviewer = parseReviewer(gateId);
    const logModel = kv.model ?? pendingTelemetryModels.get(kv.cli);
    const resolved = resolveModel(
      name,
      kv.cli,
      reviewer,
      configModels,
      overrides,
      logModel,
    );
    pendingTelemetryModels.delete(kv.cli);

    current.events.push({
      source: name,
      sourcePath: repoPath,
      timestamp: ts,
      reviewer,
      cli: kv.cli,
      model: resolved.model,
      modelSource: resolved.source,
      status: kv.status ?? 'unknown',
      durationS: parseDurationS(kv.duration),
      violations: safeNum(kv.violations),
    });
  }

  for (const cycle of cycles) {
    if (metrics.start === undefined || cycle.timestamp < metrics.start) {
      metrics.start = cycle.timestamp;
    }
    if (metrics.end === undefined || cycle.timestamp > metrics.end) {
      metrics.end = cycle.timestamp;
    }
    metrics.cycles++;
    if (cycle.hasLineStats) {
      metrics.cyclesWithLineStats++;
      metrics.linesAdded += cycle.linesAdded;
      metrics.linesRemoved += cycle.linesRemoved;
      metrics.fixedRunEndWithLineStats += cycle.fixed;
      metrics.skippedRunEndWithLineStats += cycle.skipped;
    } else {
      metrics.cyclesMissingLineStats++;
    }
    metrics.fixedRunEnd += cycle.fixed;
    metrics.skippedRunEnd += cycle.skipped;
    metrics.skippedReviewResults += cycle.skippedReviewResults;
    metrics.reviewExecutions += cycle.events.length;
    for (const event of cycle.events) {
      metrics.issuesFound += event.violations;
      if (cycle.hasLineStats)
        metrics.issuesFoundWithLineStats += event.violations;
      addModelSource(metrics.modelSources, event.modelSource);
    }
  }

  return { cycles, metrics };
}

function collapseCycleEvents(cycle: RunCycle): CycleCombo[] {
  const combos = new Map<string, CycleCombo>();
  for (const event of cycle.events) {
    const key = comboKey(event);
    const combo =
      combos.get(key) ??
      ({
        source: event.source,
        reviewer: event.reviewer,
        cli: event.cli,
        model: event.model,
        modelSource: event.modelSource,
        violations: 0,
        durationS: 0,
        statuses: [],
        executions: 0,
      } satisfies CycleCombo);
    combo.violations += event.violations;
    combo.durationS += event.durationS;
    combo.statuses.push(event.status);
    combo.executions++;
    combos.set(key, combo);
  }
  return [...combos.values()];
}

function addStatus(stats: ComboStats, status: string): void {
  if (status === 'pass') stats.pass++;
  else if (status === 'fail') stats.fail++;
  else if (status === 'error') stats.error++;
}

function addFixedNextCycle(
  aggregate: ComboStats,
  previous: CycleCombo | undefined,
  current: CycleCombo,
  hasLineStats: boolean,
): void {
  if (!previous || previous.violations <= current.violations) return;
  const fixed = previous.violations - current.violations;
  aggregate.fixedNextCycle += fixed;
  if (hasLineStats) aggregate.fixedNextCycleWithLineStats += fixed;
}

function accumulateCycles(cycles: RunCycle[]): ComboStats[] {
  const stats = new Map<string, ComboStats>();
  const previousByCombo = new Map<string, CycleCombo>();

  for (const cycle of cycles.sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  )) {
    for (const combo of collapseCycleEvents(cycle)) {
      const key = [combo.source, combo.reviewer, combo.cli, combo.model].join(
        '\t',
      );
      const aggregate =
        stats.get(key) ??
        initComboStats({
          source: combo.source,
          reviewer: combo.reviewer,
          cli: combo.cli,
          model: combo.model,
        });
      stats.set(key, aggregate);

      aggregate.cycles++;
      aggregate.executions += combo.executions;
      aggregate.issuesFound += combo.violations;
      if (cycle.hasLineStats)
        aggregate.issuesFoundWithLineStats += combo.violations;
      aggregate.durationS += combo.durationS;
      addModelSource(aggregate.modelSources, combo.modelSource);
      for (const status of combo.statuses) addStatus(aggregate, status);

      addFixedNextCycle(
        aggregate,
        previousByCombo.get(key),
        combo,
        cycle.hasLineStats,
      );
      previousByCombo.set(key, combo);
    }
  }

  return [...stats.values()].sort((a, b) => {
    const found = b.issuesFound - a.issuesFound;
    if (found !== 0) return found;
    return b.executions - a.executions;
  });
}

function walkFiles(
  dir: string,
  predicate: (file: string) => boolean,
): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(file, predicate));
    else if (predicate(file)) out.push(file);
  }
  return out;
}

function parseReviewJsonReviewer(
  filePath: string,
  adapter: string,
  knownReviewers: Set<string>,
): string | undefined {
  const base = path.basename(filePath);
  const adapterMarker = `_${adapter}@`;
  const end = base.lastIndexOf(adapterMarker);
  if (!base.startsWith('review_') || end < 0) return undefined;
  const entryAndReviewer = base.slice('review_'.length, end);
  const knownMatch = [...knownReviewers]
    .sort((a, b) => b.length - a.length)
    .find(
      (reviewer) =>
        entryAndReviewer === reviewer ||
        entryAndReviewer.endsWith(`_${reviewer}`),
    );
  if (knownMatch) return knownMatch;
  if (entryAndReviewer.startsWith('._')) return entryAndReviewer.slice(2);
  return entryAndReviewer.split('_').at(-1);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: retained JSON scan is intentionally tolerant of historical artifacts
function scanJsonReviewStats(
  repoPath: string,
  source: string,
  since: string,
  until: string,
  overrides: Map<string, string>,
): Map<string, JsonReviewStats> {
  const logDir = path.join(repoPath, 'validator_logs');
  const configModels = loadConfigModels(repoPath);
  const stats = new Map<string, JsonReviewStats>();

  for (const file of walkFiles(
    logDir,
    (f) => path.basename(f).startsWith('review_') && f.endsWith('.json'),
  )) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        adapter?: string;
        timestamp?: string;
        violations?: Array<{ status?: string }>;
      };
      if (!(raw.adapter && raw.timestamp)) continue;
      const day = localDate(raw.timestamp);
      if (day < since || day > until) continue;
      const reviewer =
        parseReviewJsonReviewer(
          file,
          raw.adapter,
          configModels.knownReviewers,
        ) ?? 'unknown';
      const resolved = resolveModel(
        source,
        raw.adapter,
        reviewer,
        configModels,
        overrides,
      );
      const key = [source, reviewer, raw.adapter, resolved.model].join('\t');
      const target =
        stats.get(key) ??
        ({
          count: 0,
          newCount: 0,
          fixedCount: 0,
          skippedCount: 0,
        } satisfies JsonReviewStats);
      stats.set(key, target);
      target.count++;
      for (const violation of raw.violations ?? []) {
        if (violation.status === 'fixed') target.fixedCount++;
        else if (violation.status === 'skipped') target.skippedCount++;
        else target.newCount++;
      }
    } catch {
      // Ignore malformed retained review artifacts; the debug log remains primary.
    }
  }

  return stats;
}

function mergeJsonStats(
  combos: ComboStats[],
  jsonStats: Map<string, JsonReviewStats>,
): ComboStats[] {
  const byKey = new Map(
    combos.map((combo) => [
      [combo.source, combo.reviewer, combo.cli, combo.model].join('\t'),
      combo,
    ]),
  );
  for (const [key, json] of jsonStats) {
    const [source, reviewer, cli, model] = key.split('\t');
    if (!(source && reviewer && cli && model)) continue;
    const combo =
      byKey.get(key) ??
      initComboStats({
        source,
        reviewer,
        cli,
        model,
      });
    byKey.set(key, combo);
    combo.jsonReviews += json.count;
    combo.jsonNew += json.newCount;
    combo.jsonFixed += json.fixedCount;
    combo.jsonSkipped += json.skippedCount;
  }
  return [...byKey.values()].sort((a, b) => {
    const found = b.issuesFound - a.issuesFound;
    if (found !== 0) return found;
    return b.executions - a.executions;
  });
}

function combineAcrossSources(combos: ComboStats[]): ComboStats[] {
  const byKey = new Map<string, ComboStats>();
  for (const combo of combos) {
    const key = [combo.reviewer, combo.cli, combo.model].join('\t');
    const target =
      byKey.get(key) ??
      initComboStats({
        source: 'all',
        reviewer: combo.reviewer,
        cli: combo.cli,
        model: combo.model,
      });
    byKey.set(key, target);
    target.executions += combo.executions;
    target.cycles += combo.cycles;
    target.pass += combo.pass;
    target.fail += combo.fail;
    target.error += combo.error;
    target.issuesFound += combo.issuesFound;
    target.issuesFoundWithLineStats += combo.issuesFoundWithLineStats;
    target.fixedNextCycle += combo.fixedNextCycle;
    target.fixedNextCycleWithLineStats += combo.fixedNextCycleWithLineStats;
    target.durationS += combo.durationS;
    target.jsonReviews += combo.jsonReviews;
    target.jsonNew += combo.jsonNew;
    target.jsonFixed += combo.jsonFixed;
    target.jsonSkipped += combo.jsonSkipped;
    for (const [source, count] of Object.entries(combo.modelSources)) {
      target.modelSources[source] = (target.modelSources[source] ?? 0) + count;
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const found = b.issuesFound - a.issuesFound;
    if (found !== 0) return found;
    return b.executions - a.executions;
  });
}

function perK(count: number, editedLines: number): number | null {
  return editedLines > 0 ? (count / editedLines) * 1000 : null;
}

function buildRateSummary(
  sources: SourceMetrics[],
  bySource: ComboStats[],
): RateSummary {
  const editedLines = sources.reduce(
    (sum, source) => sum + Math.max(source.linesAdded, source.linesRemoved),
    0,
  );
  const fixedNextCycle = bySource.reduce(
    (sum, combo) => sum + combo.fixedNextCycle,
    0,
  );
  const fixedNextCycleWithLineStats = bySource.reduce(
    (sum, combo) => sum + combo.fixedNextCycleWithLineStats,
    0,
  );
  const skippedRunEnd = sources.reduce(
    (sum, source) => sum + source.skippedRunEnd,
    0,
  );
  const skippedRunEndWithLineStats = sources.reduce(
    (sum, source) => sum + source.skippedRunEndWithLineStats,
    0,
  );
  const approxFixedNotSkipped = Math.max(0, fixedNextCycle - skippedRunEnd);
  const approxFixedNotSkippedWithLineStats = Math.max(
    0,
    fixedNextCycleWithLineStats - skippedRunEndWithLineStats,
  );

  return {
    cycles: sources.reduce((sum, source) => sum + source.cycles, 0),
    cyclesWithLineStats: sources.reduce(
      (sum, source) => sum + source.cyclesWithLineStats,
      0,
    ),
    cyclesMissingLineStats: sources.reduce(
      (sum, source) => sum + source.cyclesMissingLineStats,
      0,
    ),
    linesAdded: sources.reduce((sum, source) => sum + source.linesAdded, 0),
    linesRemoved: sources.reduce((sum, source) => sum + source.linesRemoved, 0),
    editedLines,
    issuesFound: sources.reduce((sum, source) => sum + source.issuesFound, 0),
    issuesFoundWithLineStats: sources.reduce(
      (sum, source) => sum + source.issuesFoundWithLineStats,
      0,
    ),
    fixedNextCycle,
    fixedNextCycleWithLineStats,
    fixedRunEnd: sources.reduce((sum, source) => sum + source.fixedRunEnd, 0),
    skippedRunEnd,
    fixedRunEndWithLineStats: sources.reduce(
      (sum, source) => sum + source.fixedRunEndWithLineStats,
      0,
    ),
    skippedRunEndWithLineStats,
    approxFixedNotSkipped,
    approxFixedNotSkippedWithLineStats,
    issuesFoundPerKEditedLines: perK(
      sources.reduce((sum, source) => sum + source.issuesFoundWithLineStats, 0),
      editedLines,
    ),
    approxFixedNotSkippedPerKEditedLines: perK(
      approxFixedNotSkippedWithLineStats,
      editedLines,
    ),
    fixedRunEndPerKEditedLines: perK(
      sources.reduce((sum, source) => sum + source.fixedRunEndWithLineStats, 0),
      editedLines,
    ),
  };
}

async function getAllLogDates(sourcePaths: string[]): Promise<string[]> {
  const dates = new Set<string>();
  for (const sourcePath of sourcePaths) {
    const debugLogPath = path.join(sourcePath, 'validator_logs', '.debug.log');
    if (!fs.existsSync(debugLogPath)) continue;
    const rl = readline.createInterface({
      input: fs.createReadStream(debugLogPath),
    });
    for await (const line of rl) {
      const match = line.match(/^\[(\d{4}-\d{2}-\d{2})T/);
      if (match?.[1]) dates.add(match[1]);
    }
  }
  return [...dates].sort();
}

async function resolveWindow(args: Args): Promise<{
  since: string;
  until: string;
  inferredFromLogs: boolean;
}> {
  const dates = await getAllLogDates(args.sources);
  const latestLogDate = dates.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const until = args.until ?? latestLogDate ?? today;
  const since = args.since ?? addDays(until, -(args.days - 1));
  if (since > until) throw new Error('--since must be on or before --until.');
  return {
    since,
    until,
    inferredFromLogs: !args.until && latestLogDate !== undefined,
  };
}

export async function buildMetricsReport(args: Args): Promise<MetricsReport> {
  const sources = args.sources.map((s) => path.resolve(expandHome(s)));
  const window = await resolveWindow({ ...args, sources });
  const allCycles: RunCycle[] = [];
  const sourceMetrics: SourceMetrics[] = [];
  const allJsonStats = new Map<string, JsonReviewStats>();

  for (const sourcePath of sources) {
    const { cycles, metrics } = await parseDebugLog(
      sourcePath,
      window.since,
      window.until,
      args.modelOverrides,
    );
    allCycles.push(...cycles);
    sourceMetrics.push(metrics);

    const source = sourceName(sourcePath);
    for (const [key, value] of scanJsonReviewStats(
      sourcePath,
      source,
      window.since,
      window.until,
      args.modelOverrides,
    )) {
      const target =
        allJsonStats.get(key) ??
        ({
          count: 0,
          newCount: 0,
          fixedCount: 0,
          skippedCount: 0,
        } satisfies JsonReviewStats);
      allJsonStats.set(key, target);
      target.count += value.count;
      target.newCount += value.newCount;
      target.fixedCount += value.fixedCount;
      target.skippedCount += value.skippedCount;
    }
  }

  const bySource = mergeJsonStats(accumulateCycles(allCycles), allJsonStats);
  const summary = buildRateSummary(sourceMetrics, bySource);

  return {
    window: { ...window, days: args.days },
    summary,
    sources: sourceMetrics,
    bySource,
    combined: combineAcrossSources(bySource),
  };
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function avg(total: number, count: number, digits = 2): string {
  return count > 0 ? fmt(total / count, digits) : 'n/a';
}

function rate(value: number | null, digits = 2): string {
  return value === null ? 'n/a' : fmt(value, digits);
}

function formatModelSources(sources: Record<string, number>): string {
  return Object.entries(sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, count]) => `${source}:${count}`)
    .join(', ');
}

function markdownTable(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: markdown output is clearest when assembled in one linear block
function formatMarkdown(report: MetricsReport): string {
  const sourceRows = report.sources.map((source) => [
    source.source,
    source.cycles.toString(),
    source.cyclesWithLineStats.toString(),
    source.cyclesMissingLineStats.toString(),
    Math.max(source.linesAdded, source.linesRemoved).toString(),
    source.issuesFoundWithLineStats.toString(),
    source.fixedRunEndWithLineStats.toString(),
    source.reviewExecutions.toString(),
    source.skippedReviewResults.toString(),
    source.start ?? 'n/a',
    source.end ?? 'n/a',
    formatModelSources(source.modelSources) || 'n/a',
  ]);

  const comboRows = report.combined.map((combo) => [
    combo.reviewer,
    combo.cli,
    combo.model,
    formatModelSources(combo.modelSources) || 'n/a',
    combo.executions.toString(),
    combo.cycles.toString(),
    combo.issuesFound.toString(),
    avg(combo.issuesFound, combo.cycles),
    combo.fixedNextCycle.toString(),
    avg(combo.fixedNextCycle, combo.cycles),
    `${combo.pass}/${combo.fail}/${combo.error}`,
    avg(combo.durationS, combo.executions, 1),
    combo.jsonReviews > 0
      ? `${combo.jsonFixed} fixed, ${combo.jsonSkipped} skipped, ${combo.jsonNew} new (${combo.jsonReviews} files)`
      : 'n/a',
  ]);

  return [
    `# Validator Newsletter Metrics`,
    '',
    `Window: ${report.window.since} through ${report.window.until}${
      report.window.inferredFromLogs ? ' (ending at latest log date)' : ''
    }`,
    '',
    '## Rate Summary',
    '',
    ...markdownTable(
      ['Metric', 'Value'],
      [
        ['Edited lines with line stats', fmt(report.summary.editedLines)],
        [
          'Cycles with/missing line stats',
          `${report.summary.cyclesWithLineStats}/${report.summary.cyclesMissingLineStats}`,
        ],
        [
          'Issues found with line stats',
          fmt(report.summary.issuesFoundWithLineStats),
        ],
        [
          'Issues found / 1k edited lines',
          rate(report.summary.issuesFoundPerKEditedLines),
        ],
        [
          'Approx fixed, not skipped',
          fmt(report.summary.approxFixedNotSkippedWithLineStats),
        ],
        [
          'Approx fixed, not skipped / 1k edited lines',
          rate(report.summary.approxFixedNotSkippedPerKEditedLines),
        ],
        [
          'RUN_END fixed / 1k edited lines',
          rate(report.summary.fixedRunEndPerKEditedLines),
        ],
      ],
    ),
    '',
    '## Source Coverage',
    '',
    ...markdownTable(
      [
        'Source',
        'Cycles',
        'Line-stat cycles',
        'Missing-line cycles',
        'Edited lines',
        'Issues found w/lines',
        'RUN_END fixed w/lines',
        'Review executions',
        'Cached/skipped review results',
        'First cycle',
        'Last cycle',
        'Model source counts',
      ],
      sourceRows,
    ),
    '',
    '## Reviewer / CLI / Model Metrics',
    '',
    ...markdownTable(
      [
        'Reviewer',
        'CLI',
        'Model',
        'Model source',
        'Executions',
        'Cycles',
        'Issues found',
        'Avg found/cycle',
        'Fixed next cycle',
        'Avg fixed/cycle',
        'Pass/fail/error',
        'Avg duration',
        'Retained JSON statuses',
      ],
      comboRows,
    ),
    '',
    'Notes:',
    '- Model source `current-config` means the model was inferred from the repo config as it exists now, not necessarily from the historical log line.',
    '- Model source `unknown` means the debug log and current config did not identify a model.',
    '- Fixed-next-cycle is inferred from a lower violation count in the next observed cycle for the same source/reviewer/CLI/model.',
    '- Per-1k edited-line rates use `max(lines_added, lines_removed)` from `RUN_START`, so one removed line plus one added line counts as one edited line. Cycles with older `changes=N` entries are excluded from the rate numerator and denominator.',
    '- Approx fixed-not-skipped subtracts `RUN_END skipped` from inferred fixed-next-cycle reductions. `RUN_END fixed` is also shown separately when historical logs populate it.',
    '- Retained JSON statuses come from review JSON files still present under `validator_logs`; those files may not cover the whole window.',
    '',
  ].join('\n');
}

export function formatReport(
  report: MetricsReport,
  format: OutputFormat,
): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  return formatMarkdown(report);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const report = await buildMetricsReport(args);
  console.log(formatReport(report, args.format));
}

const isDirectRun =
  (import.meta.url === `file://${process.argv[1]}` ||
    (typeof Bun !== 'undefined' && import.meta.url === `file://${Bun.main}`)) &&
  (process.argv[1]?.endsWith('newsletter-metrics.ts') ||
    process.argv[1]?.endsWith('newsletter-metrics.js'));

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
