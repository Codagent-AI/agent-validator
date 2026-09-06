import { describe, expect, test } from 'bun:test';
import {
  AdapterExecutionFailure,
  createUnavailableTelemetry,
} from '../../src/cli-adapters/shared.js';
import { CodexAdapter, parseCodexTelemetry } from '../../src/cli-adapters/codex.js';
import type { AdapterTelemetry, runStreamingCommand } from '../../src/cli-adapters/shared.js';

describe('structured adapter results', () => {
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
