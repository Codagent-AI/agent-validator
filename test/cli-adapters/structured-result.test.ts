import { describe, expect, test } from 'bun:test';
import {
  AdapterExecutionFailure,
  createUnavailableTelemetry,
} from '../../src/cli-adapters/shared.js';
import { CodexAdapter, parseCodexTelemetry } from '../../src/cli-adapters/codex.js';
import type { AdapterTelemetry, runStreamingCommand } from '../../src/cli-adapters/shared.js';

describe('structured adapter results', () => {
  test('retains a complete final usage event without a newline when the stream fails', async () => {
    const updates: AdapterTelemetry[] = [];
    const stream: typeof runStreamingCommand = async (opts) => {
      try {
        opts.onStdout?.('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}');
        expect(updates).toHaveLength(0);
        throw new Error('Command timed out');
      } finally {
        await opts.cleanup();
      }
    };
    const adapter = new CodexAdapter(stream);
    expect((adapter as unknown as { streamCommand: typeof stream }).streamCommand).toBe(stream);
    try {
      await adapter.execute({ prompt: 'synthetic fixture', diff: '', onTelemetry: (value) => updates.push(value) });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterExecutionFailure);
      const failure = error as AdapterExecutionFailure;
      expect(failure.message).toBe('Command timed out');
      expect(failure.telemetry.tokens.output.value).toBe(3);
      expect(failure.telemetry.completeness.collection).toBe('partial');
      expect(updates).toHaveLength(1);
    }
  });
  test('keeps final successful telemetry and review text when the last line has no newline', async () => {
    const raw = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"review complete"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}',
    ].join('\n');
    const updates: AdapterTelemetry[] = [];
    const stream: typeof runStreamingCommand = async (opts) => {
      try {
        for (const char of raw) opts.onStdout?.(char);
        return raw;
      } finally {
        await opts.cleanup();
      }
    };
    const adapter = new CodexAdapter(stream);
    expect((adapter as unknown as { streamCommand: typeof stream }).streamCommand).toBe(stream);
    const result = await adapter.execute({ prompt: 'synthetic fixture', diff: '', onTelemetry: (value) => updates.push(value) });
    expect(updates).toHaveLength(0);
    expect(result.text).toBe('review complete');
    expect(result.telemetry.tokens.output.value).toBe(3);
    expect(result.telemetry.completeness.collection).toBe('complete');
  });
  test('collects complete Codex lines once across chunk boundaries and ignores oversized fragments', async () => {
    const updates: AdapterTelemetry[] = [];
    const event = '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}';
    const stream: typeof runStreamingCommand = async (opts) => {
      try {
        opts.onStdout?.(event);
        expect(updates).toHaveLength(0); // Wait for the line boundary, not just valid JSON.
        opts.onStdout?.('\r\n');
        expect(updates).toHaveLength(1);
        for (const char of `${event}\n`) opts.onStdout?.(char);
        opts.onStdout?.(`${event}\n${event}\n`);
        expect(updates.map((update) => update.tokens.output.value)).toEqual([3, 6, 9, 12]);

        // A huge event is discarded through its newline; subsequent events still work.
        opts.onStdout?.('{"padding":"');
        for (let i = 0; i < 1025; i++) opts.onStdout?.('x'.repeat(1024));
        opts.onStdout?.(`",${event.slice(1)}\n${event}\n`);
        expect(updates).toHaveLength(5);
        expect(updates.at(-1)?.tokens.output.value).toBe(15);
        throw new Error('Command timed out');
      } finally {
        await opts.cleanup();
      }
    };
    const adapter = new CodexAdapter(stream);
    expect((adapter as unknown as { streamCommand: typeof stream }).streamCommand).toBe(stream);
    try {
      await adapter.execute({ prompt: 'synthetic fixture', diff: '', onTelemetry: (value) => updates.push(value) });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterExecutionFailure);
      const failure = error as AdapterExecutionFailure;
      expect(failure.message).toBe('Command timed out');
      expect(failure.telemetry.tokens.output.value).toBe(15);
      expect(failure.telemetry.completeness.collection).toBe('partial');
    }
  });
  test('publishes meaningful Codex evidence before a failed stream settles and retains it on failure', async () => {
    const updates: AdapterTelemetry[] = [];
    const stream: typeof runStreamingCommand = async (opts) => {
      try {
        opts.onStdout?.('{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":30}}\n');
        opts.onStdout?.('{"type":"item.started"}\n');
        expect(updates).toHaveLength(1);
        throw new Error('Command timed out');
      } finally { await opts.cleanup(); }
    };
    const adapter = new CodexAdapter(stream);
    // Fail before dispatch if the test seam is missing; never fall back to PATH.
    expect((adapter as unknown as { streamCommand: typeof stream }).streamCommand).toBe(stream);
    try {
      await adapter.execute({ prompt: 'synthetic fixture', diff: '', attemptId: 'attempt-fixture', onTelemetry: (telemetry) => updates.push(telemetry), onOutput: () => {} });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterExecutionFailure);
      const failure = error as AdapterExecutionFailure;
      expect(failure.message).toBe('Command timed out');
      expect(failure.telemetry.tokens.output.value).toBe(30);
      expect(failure.telemetry.completeness.collection).toBe('partial');
    }
  });
  test('makes unsupported collection explicit without promoting launch configuration', () => {
    const telemetry = createUnavailableTelemetry('cursor', {
      requestedModel: 'gpt-5',
      resolvedModel: 'gpt-5.1',
    });

    expect(telemetry.requested_identity.model).toBe('gpt-5');
    expect(telemetry.resolved_identity.model).toBe('gpt-5.1');
    expect(telemetry.observed_identities).toEqual([]);
    expect(telemetry.observed_identity_availability).toEqual({
      availability: 'unavailable',
      reason: 'adapter_usage_unsupported',
    });
    expect(telemetry.tokens.output).toMatchObject({
      availability: 'unavailable',
      value: null,
      reason: 'adapter_usage_unsupported',
    });
  });

  test('preserves safe partial telemetry and the original error on failure', () => {
    const operationalError = new Error('provider exited');
    const telemetry = createUnavailableTelemetry('cursor');
    const failure = new AdapterExecutionFailure(operationalError, telemetry);

    expect(failure.cause).toBe(operationalError);
    expect(failure.telemetry).toBe(telemetry);
    expect(failure.message).toBe('provider exited');
  });

  test('maps Codex structured completion usage without double-counting cached input', () => {
    const telemetry = parseCodexTelemetry(
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":30}}\n',
      { requestedModel: 'gpt-5' },
    );

    expect(telemetry.tokens.input_total).toMatchObject({
      availability: 'available', value: 100, included_in: null,
    });
    expect(telemetry.tokens.cache_read).toMatchObject({
      availability: 'available', value: 40, included_in: ['input_total'],
    });
    expect(telemetry.tokens.output).toMatchObject({ availability: 'available', value: 30 });
    expect(telemetry.tokens.normalized_total).toMatchObject({ availability: 'available', value: 130 });
    expect(telemetry.observed_identities).toEqual([]);
  });
});
