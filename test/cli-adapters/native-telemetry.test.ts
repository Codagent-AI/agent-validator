import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { parseCodexTelemetry } from '../../src/cli-adapters/codex.js';
import { parseClaudeOtelTelemetry, scanOtelBlocks } from '../../src/cli-adapters/claude-otel.js';

const fixture = (name: string) => readFile(new URL(`./fixtures/native-telemetry/${name}`, import.meta.url), 'utf8');

describe('recorded native telemetry accounting', () => {
  test('Codex completion includes cached input in its input total', async () => {
    const telemetry = parseCodexTelemetry(await fixture('codex-0.153.4.jsonl'));
    expect(telemetry.tokens.input_total.value).toBe(12766);
    expect(telemetry.tokens.cache_read).toMatchObject({value: 5888, included_in: ['input_total']});
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
    expect(telemetry.provenance.adapter_mapping_version).toBe('claude-otel-accounting-v2');
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
