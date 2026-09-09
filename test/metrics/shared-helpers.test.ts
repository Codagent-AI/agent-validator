import { describe, expect, test } from 'bun:test';
import * as lifecycle from '../../src/metrics/command-lifecycle.js';
import * as errors from '../../src/metrics/errors.js';

describe('shared metrics context validation', () => {
  test('preserves the optional-context and opaque-identifier behavior', () => {
    expect(lifecycle.validateMetricsContext).toBeFunction();
    expect(lifecycle.validateMetricsContext({})).toBeNull();
    expect(lifecycle.validateMetricsContext({
      metricsConsumer: '', metricsContext: '',
    })).toBeNull();
    const options = {
      metricsConsumer: ' runner ', metricsContext: 'x'.repeat(256),
    };
    expect(lifecycle.validateMetricsContext(options)).toEqual({
      consumer: options.metricsConsumer, context_id: options.metricsContext,
    });
  });

  test.each([
    { metricsConsumer: 'runner' },
    { metricsContext: 'launch' },
    { metricsConsumer: '', metricsContext: 'launch' },
  ])('rejects an unpaired context: %j', (options) => {
    expect(lifecycle.validateMetricsContext).toBeFunction();
    expect(() => lifecycle.validateMetricsContext(options)).toThrow(
      'metrics-consumer and metrics-context must be supplied together',
    );
  });

  test.each([
    ['blank consumer', { metricsConsumer: ' ', metricsContext: 'launch' }],
    ['blank context', { metricsConsumer: 'runner', metricsContext: '\t' }],
    ['oversized consumer', { metricsConsumer: 'x'.repeat(257), metricsContext: 'launch' }],
    ['oversized context', { metricsConsumer: 'runner', metricsContext: 'x'.repeat(257) }],
  ] as const)('rejects %s', (_name, options) => {
    expect(lifecycle.validateMetricsContext).toBeFunction();
    expect(() => lifecycle.validateMetricsContext(options)).toThrow(
      'metrics consumer and context must be bounded nonempty values',
    );
  });
});

test('missing-file classification distinguishes ENOENT from unrelated failures', () => {
  expect(errors.isMissingFileError).toBeFunction();
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  expect(errors.isMissingFileError(missing)).toBe(true);
  expect(errors.isMissingFileError({ code: 'ENOENT' })).toBe(true);
  for (const error of [
    null, undefined, 'ENOENT', new Error('ENOENT'),
    { code: 'EACCES' }, { code: 'ENOTDIR' },
  ]) {
    expect(errors.isMissingFileError(error)).toBe(false);
  }
});
