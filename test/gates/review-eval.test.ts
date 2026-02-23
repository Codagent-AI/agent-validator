import { describe, expect, it } from 'bun:test';
import { evaluateOutput } from '../../src/gates/review-eval.js';

// ─── evaluateOutput: basic JSON extraction ─────────────────────────────────

describe('evaluateOutput', () => {
  it('parses ```json``` fenced block', () => {
    const output = 'Some preamble\n```json\n{"status":"pass","message":"ok"}\n```\nTrailing';
    const result = evaluateOutput(output);
    expect(result.status).toBe('pass');
  });

  it('parses last JSON object when no fenced block', () => {
    const output = 'Some text {"status":"fail","violations":[{"file":"a.ts","line":1,"issue":"bad","priority":"high","status":"new"}]} trailing';
    const result = evaluateOutput(output);
    expect(result.status).toBe('fail');
  });

  it('returns error for completely non-JSON output', () => {
    const output = 'This is just plain text with no JSON at all';
    const result = evaluateOutput(output);
    expect(result.status).toBe('error');
  });
});

// ─── evaluateOutput: size guard ────────────────────────────────────────────

describe('evaluateOutput size guard', () => {
  it('parses large valid JSON output directly (no fenced block needed)', () => {
    // Build a large valid JSON response > 100KB
    const violations = Array.from({ length: 500 }, (_, i) => ({
      file: `src/module-${i}.ts`,
      line: i + 1,
      issue: `Issue number ${i} with padding ${'x'.repeat(150)}`,
      priority: 'high',
      status: 'new',
    }));
    const json = JSON.stringify({ status: 'fail', violations });
    expect(json.length).toBeGreaterThan(100_000);

    const result = evaluateOutput(json);
    expect(result.status).toBe('fail');
  });

  it('still finds ```json``` block in oversized output', () => {
    const padding = 'x'.repeat(200_000);
    const output = `${padding}\n\`\`\`json\n{"status":"pass","message":"ok"}\n\`\`\`\n${padding}`;
    const result = evaluateOutput(output);
    expect(result.status).toBe('pass');
  });

  it('returns error with size message when output > 100KB and no fenced block', () => {
    // Build a large string with many { characters but no valid review JSON
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(`{ resource: {}, body: "event_${i}", attributes: { key: "val" } }`);
    }
    const output = lines.join('\n');
    expect(output.length).toBeGreaterThan(100_000);

    const result = evaluateOutput(output);
    expect(result.status).toBe('error');
    expect(result.message).toContain('too large');
  });

  it('completes quickly on large non-JSON output (no event-loop blocking)', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10000; i++) {
      lines.push(`{ resource: {}, body: "event_${i}", attributes: { key: "val" } }`);
    }
    const output = lines.join('\n');

    const start = performance.now();
    const result = evaluateOutput(output);
    const elapsed = performance.now() - start;

    expect(result.status).toBe('error');
    // Must complete in under 1s — without the fix this would block for minutes+
    expect(elapsed).toBeLessThan(1000);
  });
});

// ─── tryParseLastJson iteration cap ────────────────────────────────────────

describe('tryParseLastJson iteration cap', () => {
  it('finds JSON near the end of output even with many { chars', () => {
    // Put valid JSON near the end, preceded by many { characters
    const junk = Array.from({ length: 40 }, (_, i) => `{ junk_${i} }`).join('\n');
    const validJson = '{"status":"pass","message":"found it"}';
    // Output is small enough to pass the size guard
    const output = `${junk}\n${validJson}`;
    expect(output.length).toBeLessThan(100_000);

    const result = evaluateOutput(output);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('found it');
  });

  it('gives up after max iterations without blocking', () => {
    // More than 50 { positions — tryParseLastJson hits cap and bails
    const junkLines: string[] = [];
    for (let i = 0; i < 60; i++) {
      junkLines.push(`{ invalid_${i} }`);
    }
    const output = junkLines.join('\n');
    expect(output.length).toBeLessThan(100_000);

    const start = performance.now();
    const result = evaluateOutput(output);
    const elapsed = performance.now() - start;

    // Must complete quickly — without the cap this would try all 60+ positions
    expect(elapsed).toBeLessThan(1000);
    expect(result.status).toBe('error');
  });
});
