import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { parseCodexTelemetry } from '../../src/cli-adapters/codex.js';
import { createClaudeTelemetryCollector, parseClaudeOtelTelemetry, scanOtelBlocks } from '../../src/cli-adapters/claude-otel.js';

const fixture = (name: string) => readFile(new URL(`./fixtures/native-telemetry/${name}`, import.meta.url), 'utf8');

describe('recorded native telemetry accounting', () => {
  // Recorded from Claude Code 2.1.288 with a subagent and a 1 s export interval:
  // 14 cumulative metric exports, each carrying one series per thread and model,
  // with the metric descriptor's own `type: "COUNTER"` ahead of the data points.
  // Its five api_request events sum to exactly the final export's series.
  const SUBAGENT_FIXTURE = 'claude-2.1.288-subagent-cumulative.txt';
  const SUBAGENT_TOTALS = {input: 10, output: 1319, cacheRead: 76346, cacheCreation: 51329};

  test('Claude sums every thread series of the latest cumulative export', async () => {
    const telemetry = parseClaudeOtelTelemetry(await fixture(SUBAGENT_FIXTURE));
    expect(telemetry.tokens.input_uncached.value).toBe(SUBAGENT_TOTALS.input);
    expect(telemetry.tokens.output.value).toBe(SUBAGENT_TOTALS.output);
    expect(telemetry.tokens.cache_read.value).toBe(SUBAGENT_TOTALS.cacheRead);
    expect(telemetry.tokens.cache_write.value).toBe(SUBAGENT_TOTALS.cacheCreation);
    expect(telemetry.tokens.input_total.value).toBe(127685);
    // A process that has not been seen to finish may still have unexported work.
    expect(telemetry.tokens.normalized_total.availability).toBe('unavailable');
    expect(telemetry.completeness.collection).toBe('partial');
  });

  test('Claude establishes the total once the process completed its final export', async () => {
    const telemetry = parseClaudeOtelTelemetry(await fixture(SUBAGENT_FIXTURE), {processCompleted: true});
    expect(telemetry.tokens.input_total.value).toBe(127685);
    expect(telemetry.tokens.normalized_total).toMatchObject({
      availability: 'available', value: 129004, origin: 'derived', source: 'validator_derivation',
    });
    expect(telemetry.completeness.collection).toBe('complete');
    expect(telemetry.completeness.normalized_total).toBe('complete');
    expect(telemetry.diagnostics).toEqual([]);
  });

  test('Claude streaming checkpoints end at the same thread totals', async () => {
    const values: number[] = [];
    const collector = createClaudeTelemetryCollector({}, telemetry => values.push(telemetry.tokens.input_total.value!));
    collector.write(await fixture(SUBAGENT_FIXTURE));
    collector.flush();
    expect(values.at(-1)).toBe(127685);
  });

  test('Claude never establishes a total from request events or an incomplete input breakdown', async () => {
    const {logBlocks, metricBlocks} = scanOtelBlocks(await fixture(SUBAGENT_FIXTURE));
    const fromLogs = parseClaudeOtelTelemetry(logBlocks.join('\n'), {processCompleted: true});
    expect(fromLogs.tokens.normalized_total.availability).toBe('unavailable');
    expect(fromLogs.completeness.collection).toBe('partial');
    const lastExport = metricBlocks.filter(block => block.includes('claude_code.token.usage')).at(-1)!;
    const withoutCacheWrite = lastExport.replace(/type: "cacheCreation"/g, 'type: "somethingElse"');
    const partial = parseClaudeOtelTelemetry(withoutCacheWrite, {processCompleted: true});
    expect(partial.tokens.input_total.availability).toBe('unavailable');
    expect(partial.tokens.normalized_total.availability).toBe('unavailable');
    expect(partial.completeness.collection).toBe('partial');
  });

  test('Claude checkpoints prefer cumulative metrics over overlapping request events in either order', async () => {
    const {metricBlocks, logBlocks} = scanOtelBlocks(await fixture('claude-2.1.261-cache-write.txt'));
    for (const blocks of [[...metricBlocks,...logBlocks],[...logBlocks,...metricBlocks]]) {
      const values: number[] = [];
      const collector = createClaudeTelemetryCollector({}, telemetry => values.push(telemetry.tokens.input_total.value!));
      collector.write(blocks.join('\n'));
      collector.flush();
      expect(values).toEqual([7511,7511]);
      collector.write(blocks.join('\n'));
      expect(values).toHaveLength(2);
    }
  });

  test.each(['line', 'block'])('Claude bounds retained %s fragments and preserves preceding checkpoints', async kind => {
    const raw = await fixture('claude-2.1.261-cache-write.txt');
    const values: number[] = [];
    const collector = createClaudeTelemetryCollector({}, telemetry => values.push(telemetry.tokens.input_total.value!));
    collector.write(raw);
    const prior = [...values];
    expect(prior.at(-1)).toBe(7511);
    collector.write(kind==='line' ? 'x'.repeat(1024*1024+1)+'\n' : '{\n'+('  ignored: 0,\n').repeat(100000));
    collector.write(raw);
    collector.flush();
    expect(values).toEqual(prior);
  });
  test('Codex completion includes cached input in its input total', async () => {
    const telemetry = parseCodexTelemetry(await fixture('codex-0.153.4.jsonl'));
    expect(telemetry.tokens.input_total.value).toBe(12766);
    expect(telemetry.tokens.cache_read).toMatchObject({value: 5888, included_in: ['input_total']});
    expect(telemetry.tokens.input_uncached).toMatchObject({value: 6878, origin: 'derived', derivation: 'codex_input_total_minus_cache_read'});
    expect(telemetry.tokens.output.value).toBe(5);
    expect(telemetry.tokens.normalized_total.value).toBe(12771);
  });

  test.each([
    ['claude-2.1.261.txt', 3504, 0, 3504],
    ['claude-2.1.261-cache-write.txt', 3, 7508, 7511],
  ] as const)('Claude %s keeps uncached input separate and adds cache exactly once', async (name, uncached, written, total) => {
    const telemetry = parseClaudeOtelTelemetry(await fixture(name));
    expect(telemetry.tokens.input_uncached).toMatchObject({value: uncached, origin: 'observed', included_in: ['input_total']});
    expect(telemetry.tokens.cache_write.value).toBe(written);
    expect(telemetry.tokens.input_total).toMatchObject({value: total, origin: 'derived', source: 'validator_derivation'});
    expect(telemetry.tokens.output.value).toBe(4);
    expect(telemetry.provider_native_usage).toContainEqual({source: 'provider_event', name: 'claude_otel_input', value: uncached});
    expect(telemetry.provenance.adapter_mapping_version).toBe('claude-otel-series-v4');
    expect(telemetry.tokens.normalized_total.availability).toBe('unavailable');
  });

  test('numeric API-request fallback agrees with metric counters, without adding overlapping sources', async () => {
    const raw = await fixture('claude-2.1.261-cache-write.txt');
    const { logBlocks } = scanOtelBlocks(raw);
    expect(logBlocks).toHaveLength(1);
    expect(parseClaudeOtelTelemetry(logBlocks.join('\n')).tokens).toEqual(parseClaudeOtelTelemetry(raw).tokens);
  });

  test('missing cache evidence stays unavailable instead of turning uncached input into total input', async () => {
    const { logBlocks } = scanOtelBlocks(await fixture('claude-2.1.261-cache-write.txt'));
    const raw = logBlocks.join('\n').replace(/^.*cache_creation_tokens:.*\n/m, '');
    const telemetry = parseClaudeOtelTelemetry(raw);
    expect(telemetry.tokens.input_uncached.value).toBe(3);
    expect(telemetry.tokens.cache_write.availability).toBe('unavailable');
    expect(telemetry.tokens.input_total.availability).toBe('unavailable');
  });

  test('one complete API event cannot hide missing cache evidence in another', async () => {
    const { logBlocks } = scanOtelBlocks(await fixture('claude-2.1.261-cache-write.txt'));
    const complete = logBlocks.join('\n');
    const missing = complete.replace(/^.*cache_creation_tokens:.*\n/m, '');
    expect(parseClaudeOtelTelemetry(`${complete}\n${missing}`).tokens.input_total.availability).toBe('unavailable');
  });

  test('an unrelated metric does not suppress usable API-request evidence', async () => {
    const { logBlocks } = scanOtelBlocks(await fixture('claude-2.1.261-cache-write.txt'));
    const otherMetric = '{\n descriptor: { name: "claude_code.cost.usage" },\n dataPointType: 3,\n dataPoints: [{ value: 0.01 }],\n}';
    expect(parseClaudeOtelTelemetry(`${otherMetric}\n${logBlocks.join('\n')}`).tokens.input_total.value).toBe(7511);
  });
});
