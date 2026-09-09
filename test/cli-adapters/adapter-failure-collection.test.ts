import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { ClaudeAdapter } from '../../src/cli-adapters/claude.js';
import { OpenCodeAdapter } from '../../src/cli-adapters/opencode.js';
import { GeminiAdapter } from '../../src/cli-adapters/gemini.js';
import { GitHubCopilotAdapter, parseCopilotTelemetry } from '../../src/cli-adapters/github-copilot.js';
import { validateAttempt } from '../../src/metrics/validation.js';
import { AdapterExecutionFailure, type runStreamingCommand } from '../../src/cli-adapters/shared.js';

test('OpenCode publishes accumulated usage before subprocess final collection', async () => {
  const observed: number[] = [];
  const event = '{"type":"step_finish","part":{"tokens":{"input":10,"output":3}}}\n';
  const stream: typeof runStreamingCommand = async opts => {
    try {
      opts.onStdout?.(event.slice(0, 20));
      expect(observed).toEqual([]);
      opts.onStdout?.(event.slice(20));
      expect(observed).toEqual([3]);
      opts.onStdout?.(event);
      expect(observed).toEqual([3, 6]);
      await opts.onCollected?.(event + event, '');
      throw new Error('controlled process failure');
    } finally { await opts.cleanup(); }
  };
  const adapter = new OpenCodeAdapter(stream);
  expect((adapter as unknown as {streamCommand: unknown}).streamCommand).toBe(stream);
  (adapter as unknown as {getBin: () => Promise<string>}).getBin = async () => 'opencode';
  await expect(adapter.execute({prompt:'synthetic',diff:'',onTelemetry: value => observed.push(value.tokens.output.value!)})).rejects.toThrow('controlled process failure');
  expect(observed.at(-1)).toBe(6);
});

test('Copilot observed identity IDs remain stable when model rows reorder', () => {
  const prefix = 'Total usage est: 2 Premium requests\n';
  const a = ' model-a 10 in, 3 out\n';
  const b = ' model-b 20 in, 4 out\n';
  const ids = (raw: string) => Object.fromEntries(parseCopilotTelemetry(raw).observed_identities.map(value => [value.model, value.identity_id]));
  expect(ids(prefix + a + b)).toEqual(ids(prefix + b + a));
});

test.each([
  ['GEMINI_TELEMETRY_ENABLED', 'false', 'gemini_telemetry_disabled'],
  ['GEMINI_TELEMETRY_OUTFILE', '/not-owned-by-validator', 'gemini_telemetry_redirected'],
])('Gemini reports caller-controlled collection limits for %s', async (key, value, reason) => {
  const previous = process.env[key];
  process.env[key] = value;
  try {
    const stream: typeof runStreamingCommand = async opts => {
      try { await opts.onCollected?.('', ''); return ''; }
      finally { await opts.cleanup(); }
    };
    const adapter = new GeminiAdapter(stream);
    expect((adapter as unknown as {streamCommand: unknown}).streamCommand).toBe(stream);
    const result = await adapter.execute({prompt:'synthetic',diff:''});
    expect(result.telemetry.tokens.input_total).toMatchObject({availability:'unavailable',reason});
    expect(result.telemetry.diagnostics).toContain(reason);
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
});

for (const streaming of [false, true]) {
  test(`Claude publishes native usage before terminal collection with output callback ${streaming}`, async () => {
    const raw = await readFile(new URL('./fixtures/native-telemetry/claude-2.1.261-cache-write.txt', import.meta.url), 'utf8');
    const observed: number[] = [];
    const stream: typeof runStreamingCommand = async opts => {
      try {
        for (let offset = 0; offset < raw.length; offset += 17) opts.onStdout?.(raw.slice(offset, offset + 17));
        expect(observed).toContain(7511);
        await opts.onCollected?.(raw, '');
        throw new Error('controlled process failure');
      } finally { await opts.cleanup(); }
    };
    const adapter = new ClaudeAdapter(stream);
    expect((adapter as unknown as {streamCommand: unknown}).streamCommand).toBe(stream);
    await expect(adapter.execute({prompt:'synthetic',diff:'',onOutput:streaming?()=>{}:undefined,onTelemetry:value=>{if(value.tokens.input_total.value!==null) observed.push(value.tokens.input_total.value);}})).rejects.toThrow('controlled process failure');
  });
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
          await writeFile(telemetryFile!, JSON.stringify({ scopeMetrics: [{ metrics: [{ descriptor: {name: 'gemini_cli.token.usage'}, dataPoints: [{attributes:{type:'input'},value:10},{attributes:{type:'output'},value:3},{attributes:{type:'cache'},value:4}] }] }] }));
        }
        await opts.onCollected?.('{"type":"step_finish","part":{"tokens":{"input":10,"output":3,"cache":{"read":4,"write":2}}}}\n', '');
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
      expect(telemetry.tokens.cache_read.value).toBe(4);
      expect(telemetry.tokens.cache_read.included_in).toBeNull();
      const fixture = JSON.parse(await readFile(new URL('../../contracts/model-metrics/v1/fixtures/two-model-allocation-cost.json', import.meta.url), 'utf8'));
      const record = {...fixture.records[0], ...telemetry, completeness: {...telemetry.completeness, history: 'complete'}, provenance:{...fixture.records[0].provenance,...telemetry.provenance}};
      expect(validateAttempt(record).success).toBe(true);
    }
  });
}
