import { describe, expect, it } from 'bun:test';
import {
  countBraceChange,
  classifyBlock,
  scanOtelBlocks,
  extractOtelMetrics,
} from '../../src/cli-adapters/claude.js';

// ─── countBraceChange ───────────────────────────────────────────────────────

describe('countBraceChange', () => {
  it('returns 0 for plain text', () => {
    expect(countBraceChange('hello world')).toBe(0);
  });

  it('counts opening braces', () => {
    expect(countBraceChange('  {')).toBe(1);
    expect(countBraceChange('{ {')).toBe(2);
  });

  it('counts closing braces', () => {
    expect(countBraceChange('  }')).toBe(-1);
  });

  it('handles nested braces on same line', () => {
    expect(countBraceChange('{ key: { nested: 1 } }')).toBe(0);
  });

  it('ignores braces inside double-quoted strings', () => {
    expect(countBraceChange('name: "some{thing}"')).toBe(0);
  });

  it('ignores braces inside single-quoted strings', () => {
    expect(countBraceChange("body: 'claude_code.{test}'")).toBe(0);
  });

  it('handles escaped quotes', () => {
    // The backslash-quote keeps us inside the string
    expect(countBraceChange(String.raw`name: "foo\"}" extra {`)).toBe(1);
  });

  it('returns 0 for empty line', () => {
    expect(countBraceChange('')).toBe(0);
  });
});

// ─── classifyBlock ──────────────────────────────────────────────────────────

describe('classifyBlock', () => {
  it('identifies metric blocks', () => {
    const block = `{
  descriptor: {
    name: "claude_code.cost.usage",
    dataPointType: 3,
    dataPoints: [
      { value: 0.05 }
    ]
  }
}`;
    expect(classifyBlock(block)).toBe('metric');
  });

  it('identifies log blocks', () => {
    const block = `{
  resource: {
    attributes: {}
  },
  body: 'claude_code.tool_result',
  attributes: {
    tool_result_size_bytes: '1234'
  }
}`;
    expect(classifyBlock(block)).toBe('log');
  });

  it('returns other for non-OTel JSON blocks', () => {
    const block = `{
  "type": "result",
  "content": "some output"
}`;
    expect(classifyBlock(block)).toBe('other');
  });

  it('returns other when only some metric fields present', () => {
    const block = `{
  descriptor: { name: "foo" }
}`;
    expect(classifyBlock(block)).toBe('other');
  });

  it('returns other for log-like block without claude_code body', () => {
    const block = `{
  resource: {},
  body: 'some.other.event'
}`;
    expect(classifyBlock(block)).toBe('other');
  });
});

// ─── scanOtelBlocks ─────────────────────────────────────────────────────────

describe('scanOtelBlocks', () => {
  it('returns plain text unchanged when no blocks present', () => {
    const input = 'line 1\nline 2\nline 3';
    const result = scanOtelBlocks(input);
    expect(result.metricBlocks).toHaveLength(0);
    expect(result.logBlocks).toHaveLength(0);
    expect(result.cleaned).toBe(input);
  });

  it('extracts a single metric block', () => {
    const metric = `{
  descriptor: {
    name: "claude_code.cost.usage",
    dataPointType: 3,
    dataPoints: [
      { value: 0.05 }
    ]
  }
}`;
    const input = `before\n${metric}\nafter`;
    const result = scanOtelBlocks(input);
    expect(result.metricBlocks).toHaveLength(1);
    expect(result.metricBlocks[0]).toBe(metric);
    expect(result.logBlocks).toHaveLength(0);
    expect(result.cleaned).toBe('before\nafter');
  });

  it('extracts a single log block', () => {
    const log = `{
  resource: { attributes: {} },
  body: 'claude_code.tool_result',
  attributes: { tool_result_size_bytes: '500' }
}`;
    const input = `output\n${log}\nmore output`;
    const result = scanOtelBlocks(input);
    expect(result.logBlocks).toHaveLength(1);
    expect(result.logBlocks[0]).toBe(log);
    expect(result.metricBlocks).toHaveLength(0);
    expect(result.cleaned).toBe('output\nmore output');
  });

  it('handles mixed metric and log blocks', () => {
    const metric = `{
  descriptor: { name: "claude_code.token.usage" },
  dataPointType: 1,
  dataPoints: [ { value: 100 } ]
}`;
    const log = `{
  resource: {},
  body: 'claude_code.api_request',
  attributes: { input_tokens: '50' }
}`;
    const input = `start\n${metric}\nmiddle\n${log}\nend`;
    const result = scanOtelBlocks(input);
    expect(result.metricBlocks).toHaveLength(1);
    expect(result.logBlocks).toHaveLength(1);
    expect(result.cleaned).toBe('start\nmiddle\nend');
  });

  it('handles [otel] prefixed block start', () => {
    const block = `[otel] {
  descriptor: { name: "claude_code.cost.usage" },
  dataPointType: 3,
  dataPoints: [ { value: 0.01 } ]
}`;
    const result = scanOtelBlocks(block);
    expect(result.metricBlocks).toHaveLength(1);
  });

  it('preserves non-OTel brace blocks', () => {
    const jsonBlock = `{
  "type": "result",
  "content": "hello"
}`;
    const input = `output\n${jsonBlock}\nmore`;
    const result = scanOtelBlocks(input);
    expect(result.metricBlocks).toHaveLength(0);
    expect(result.logBlocks).toHaveLength(0);
    expect(result.cleaned).toBe(input);
  });

  it('recovers unclosed brace blocks (no data loss)', () => {
    const input = 'before\n{\n  unclosed: true\nafter';
    const result = scanOtelBlocks(input);
    expect(result.metricBlocks).toHaveLength(0);
    expect(result.logBlocks).toHaveLength(0);
    // All lines including the unclosed block should be in cleaned output
    expect(result.cleaned).toBe(input);
  });

  it('handles empty input', () => {
    const result = scanOtelBlocks('');
    expect(result.metricBlocks).toHaveLength(0);
    expect(result.logBlocks).toHaveLength(0);
    expect(result.cleaned).toBe('');
  });

  it('handles multiple consecutive metric blocks', () => {
    const block1 = `{
  descriptor: { name: "claude_code.cost.usage" },
  dataPointType: 3,
  dataPoints: [ { value: 0.05 } ]
}`;
    const block2 = `{
  descriptor: { name: "claude_code.token.usage" },
  dataPointType: 1,
  dataPoints: [ { value: 200 } ]
}`;
    const input = `${block1}\n${block2}`;
    const result = scanOtelBlocks(input);
    expect(result.metricBlocks).toHaveLength(2);
    expect(result.cleaned).toBe('');
  });
});

// ─── extractOtelMetrics (end-to-end) ────────────────────────────────────────

describe('extractOtelMetrics', () => {
  it('extracts cost from metric block', () => {
    const raw = `review output here
{
  descriptor: {
    name: "claude_code.cost.usage",
    description: "Usage cost",
    unit: "usd",
    type: "HISTOGRAM",
    valueType: 1,
    advice: {}
  },
  dataPointType: 0,
  dataPoints: [
    {
      attributes: {},
      startTime: [1000, 0],
      endTime: [2000, 0],
      value: 0.1234,
      count: 1,
      sum: 0.1234,
      min: 0.1234,
      max: 0.1234
    }
  ]
}
trailing text`;

    const logs: string[] = [];
    const cleaned = extractOtelMetrics(raw, (msg) => logs.push(msg));
    expect(cleaned).toBe('review output here\ntrailing text');
    expect(logs.some((l) => l.includes('cost=$0.1234'))).toBe(true);
  });

  it('extracts token usage from metric block', () => {
    const raw = `output
{
  descriptor: {
    name: "claude_code.token.usage",
    description: "Token usage",
    unit: "tokens",
    type: "SUM",
    valueType: 1
  },
  dataPointType: 3,
  dataPoints: [
    {
      attributes: { type: "input" },
      value: 5000
    },
    {
      attributes: { type: "output" },
      value: 2000
    }
  ]
}`;
    const cleaned = extractOtelMetrics(raw);
    expect(cleaned).toBe('output');
  });

  it('accumulates tool_result log events', () => {
    // Include a cost metric so the summary is actually logged
    const raw = `output
{
  descriptor: {
    name: "claude_code.cost.usage"
  },
  dataPointType: 3,
  dataPoints: [
    { value: 0.05 }
  ]
}
{
  resource: { attributes: {} },
  body: 'claude_code.tool_result',
  attributes: {
    tool_result_size_bytes: '1500'
  }
}
{
  resource: { attributes: {} },
  body: 'claude_code.tool_result',
  attributes: {
    tool_result_size_bytes: '2500'
  }
}`;
    const logs: string[] = [];
    const cleaned = extractOtelMetrics(raw, (msg) => logs.push(msg));
    expect(cleaned).toBe('output');
    // Should have accumulated 2 tool calls
    expect(logs.some((l) => l.includes('tool_calls=2'))).toBe(true);
    expect(logs.some((l) => l.includes('tool_content_bytes=4000'))).toBe(true);
  });

  it('accumulates api_request log events', () => {
    const raw = `output
{
  resource: {},
  body: 'claude_code.api_request',
  attributes: {
    input_tokens: '100',
    output_tokens: '50',
    cost_usd: '0.01'
  }
}`;
    const logs: string[] = [];
    extractOtelMetrics(raw, (msg) => logs.push(msg));
    expect(logs.some((l) => l.includes('api_requests=1'))).toBe(true);
    expect(logs.some((l) => l.includes('cost=$0.0100'))).toBe(true);
  });

  it('returns raw output when no OTel blocks present', () => {
    const raw = 'just plain output\nwith multiple lines';
    const cleaned = extractOtelMetrics(raw);
    expect(cleaned).toBe(raw);
  });

  it('trims trailing whitespace', () => {
    const raw = 'output   \n\n  ';
    const cleaned = extractOtelMetrics(raw);
    expect(cleaned).toBe('output');
  });
});

// ─── Performance regression test ────────────────────────────────────────────

/** Build adversarial input of approximately `lineCount` lines with OTel-like patterns. */
function buildAdversarialInput(lineCount: number): string {
  const chunks: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    chunks.push(`line ${i}: descriptor: { dataPointType: stuff }`);
    chunks.push(`resource: { body: 'something' }`);
    chunks.push(`some { nested { content } with } braces`);
  }
  return chunks.join('\n');
}

describe('performance', () => {
  it('scales near-linearly: 4x input completes in <= 6x time (no backtracking)', () => {
    // Use relative scaling to avoid flaky wall-clock assertions on slow CI runners.
    // A backtracking regex would show O(n^2+) growth; linear scanner should be ~O(n).
    const smallInput = buildAdversarialInput(1000);
    const largeInput = buildAdversarialInput(4000);
    expect(largeInput.length).toBeGreaterThan(200_000);

    const smallStart = performance.now();
    scanOtelBlocks(smallInput);
    const smallElapsed = performance.now() - smallStart;

    const largeStart = performance.now();
    const result = scanOtelBlocks(largeInput);
    const largeElapsed = performance.now() - largeStart;

    // 4x input should complete in at most 6x time (generous margin for GC jitter)
    const scalingFactor = smallElapsed > 0 ? largeElapsed / smallElapsed : 1;
    expect(scalingFactor).toBeLessThan(6);
    // None of these partial patterns should be classified as OTel blocks
    expect(result.metricBlocks).toHaveLength(0);
    expect(result.logBlocks).toHaveLength(0);
  });

  it('correctly extracts real OTel blocks from large mixed input', () => {
    const chunks: string[] = [];
    for (let i = 0; i < 3000; i++) {
      chunks.push(`review line ${i}: some code content here`);
    }
    for (let i = 0; i < 10; i++) {
      chunks.push(`{
  descriptor: { name: "claude_code.cost.usage" },
  dataPointType: 3,
  dataPoints: [ { value: ${(0.01 * i).toFixed(4)} } ]
}`);
    }
    for (let i = 0; i < 3000; i++) {
      chunks.push(`more review line ${i}`);
    }
    const input = chunks.join('\n');
    expect(input.length).toBeGreaterThan(100_000);

    const result = scanOtelBlocks(input);
    expect(result.metricBlocks).toHaveLength(10);
  });
});
