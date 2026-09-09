import { describe, expect, test } from 'bun:test';
import { shouldCleanGateOutcome } from '../../src/commands/gate-command.js';

describe('gate command lifecycle cleanup', () => {
  test('cleans retry-limit outcomes even when a gate failed', () => {
    expect(
      shouldCleanGateOutcome({
        allPassed: false,
        retryLimitExceeded: true,
      }),
    ).toBe(true);
  });

  test('retains retry logs while failures remain recoverable', () => {
    expect(
      shouldCleanGateOutcome({
        allPassed: false,
        retryLimitExceeded: false,
      }),
    ).toBe(false);
  });
});
