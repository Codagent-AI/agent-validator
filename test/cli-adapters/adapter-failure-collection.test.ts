import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { ClaudeAdapter } from '../../src/cli-adapters/claude.js';
import { OpenCodeAdapter } from '../../src/cli-adapters/opencode.js';
import { GeminiAdapter } from '../../src/cli-adapters/gemini.js';
import { GitHubCopilotAdapter, parseCopilotTelemetry } from '../../src/cli-adapters/github-copilot.js';
import { validateAttempt } from '../../src/metrics/validation.js';
import { AdapterExecutionFailure, type runStreamingCommand } from '../../src/cli-adapters/shared.js';

for (const streaming of [false, true]) {
  test(`Claude retains native usage on failure with output callback ${streaming}`, async () => {
    const raw = await readFile(new URL('./fixtures/native-telemetry/claude-2.1.261-cache-write.txt', import.meta.url), 'utf8');
    const stream: typeof runStreamingCommand = async opts => {
      try {
        await opts.onCollected?.(raw, '');
        throw new Error('controlled process failure');
      } finally {
        await opts.cleanup();
      }
    };
    const adapter = Reflect.construct(ClaudeAdapter, [stream]) as ClaudeAdapter;
    // Missing DI must fail before any authenticated executable can be reached.
    expect((adapter as unknown as { streamCommand: unknown }).streamCommand).toBe(stream);
    try {
      await adapter.execute({ prompt: 'synthetic', diff: '', onOutput: streaming ? () => {} : undefined });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterExecutionFailure);
      expect((error as AdapterExecutionFailure).telemetry.tokens.input_total.value).toBe(7511);
      expect((error as AdapterExecutionFailure).telemetry.completeness.collection).toBe('partial');
    }
  });
}

test('Copilot missing rows/cache fields do not fabricate observed zero tokens', () => {
  const absent = parseCopilotTelemetry('Total usage est: 1 Premium request\n');
  expect(absent.tokens.input_total.value).toBeNull();
  const partial = parseCopilotTelemetry('Total usage est: 1 Premium request\n model-a 10 in, 3 out\n');
  expect(partial.tokens.input_total.value).toBe(10);
  expect(partial.tokens.cache_read.value).toBeNull();
});

test('Copilot preserves collected summary when execution fails', async () => {
  const adapter = new GitHubCopilotAdapter();
  const summary = 'Total usage est: 1 Premium request\n model-a 10 in, 3 out, 0 cached\n';
  const run = async (opts: {onCollected?: (stdout: string, stderr: string) => void}) => {
    opts.onCollected?.('', summary);
    throw new Error('controlled failure');
  };
  (adapter as unknown as {runCopilot: typeof run}).runCopilot = run;
  try {
    await adapter.execute({prompt:'synthetic',diff:''});
    throw new Error('expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterExecutionFailure);
    const telemetry = (error as AdapterExecutionFailure).telemetry;
    expect(telemetry.tokens.output.value).toBe(3);
    const fixture = JSON.parse(await readFile(new URL('../../contracts/model-metrics/v1/fixtures/two-model-allocation-cost.json', import.meta.url), 'utf8'));
    expect(validateAttempt({...fixture.records[0],...telemetry,completeness:{...telemetry.completeness,history:'complete'},provenance:{...fixture.records[0].provenance,...telemetry.provenance}}).success).toBe(true);
  }
});

for (const Adapter of [OpenCodeAdapter, GeminiAdapter]) {
  test(`${Adapter.name} retains and can persist evidence before source cleanup on failure`, async () => {
    const stream: typeof runStreamingCommand = async opts => {
      try {
        if (opts.command === 'gemini') {
          const telemetryFile = opts.env?.GEMINI_TELEMETRY_OUTFILE;
          expect(telemetryFile).toBeDefined();
          await writeFile(telemetryFile!, JSON.stringify({ scopeMetrics: [{ metrics: [{ descriptor: {name: 'gemini_cli.token.usage'}, dataPoints: [{attributes:{type:'input'},value:10},{attributes:{type:'output'},value:3}] }] }] }));
        }
        await opts.onCollected?.('{"type":"step_finish","part":{"tokens":{"input":10,"output":3}}}\n', '');
        throw new Error('controlled process failure');
      } finally { await opts.cleanup(); }
    };
    const adapter = Reflect.construct(Adapter, [stream]) as OpenCodeAdapter | GeminiAdapter;
    expect((adapter as unknown as { streamCommand: unknown }).streamCommand).toBe(stream);
    if (adapter instanceof OpenCodeAdapter) {
      (adapter as unknown as { getBin: () => Promise<string> }).getBin = async () => 'opencode';
    }
    try {
      await adapter.execute({prompt:'synthetic', diff:'', onOutput: () => {}});
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterExecutionFailure);
      const telemetry = (error as AdapterExecutionFailure).telemetry;
      expect(telemetry.tokens.output.value).toBe(3);
      const fixture = JSON.parse(await readFile(new URL('../../contracts/model-metrics/v1/fixtures/two-model-allocation-cost.json', import.meta.url), 'utf8'));
      const record = {...fixture.records[0], ...telemetry, completeness: {...telemetry.completeness, history: 'complete'}, provenance:{...fixture.records[0].provenance,...telemetry.provenance}};
      expect(validateAttempt(record).success).toBe(true);
    }
  });
}
