import { describe, expect, test } from 'bun:test';
import {
  AdapterExecutionFailure,
  createUnavailableTelemetry,
} from '../../src/cli-adapters/shared.js';
import { parseCodexTelemetry } from '../../src/cli-adapters/codex.js';

describe('structured adapter results', () => {
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
