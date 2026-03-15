import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReviewFullJsonOutput } from '../../src/gates/result.js';
import { enumerateNewViolations } from '../../src/output/report.js';

const TEST_DIR = path.join(import.meta.dir, '../../.test-update-review');

beforeEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe('update-review violation mutation', () => {
  it('enumerateNewViolations produces IDs matching between calls', async () => {
    const jsonPath = path.join(
      TEST_DIR,
      'review_src_quality_claude@1.1.json',
    );
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          {
            file: 'src/foo.ts',
            line: 10,
            issue: 'Issue A',
            status: 'new',
          },
          {
            file: 'src/bar.ts',
            line: 20,
            issue: 'Issue B',
            status: 'new',
          },
          {
            file: 'src/baz.ts',
            line: 30,
            issue: 'Issue C',
            status: 'new',
          },
        ],
      }),
    );

    // First call
    const violations1 = await enumerateNewViolations(TEST_DIR);
    expect(violations1).toHaveLength(3);

    // Second call (simulating update-review list after report)
    const violations2 = await enumerateNewViolations(TEST_DIR);
    expect(violations2).toHaveLength(3);

    // Verify IDs are stable
    for (let i = 0; i < 3; i++) {
      expect(violations1[i]!.id).toBe(violations2[i]!.id);
      expect(violations1[i]!.file).toBe(violations2[i]!.file);
      expect(violations1[i]!.line).toBe(violations2[i]!.line);
    }
  });

  it('marking a violation as fixed mutates the JSON file', async () => {
    const jsonPath = path.join(
      TEST_DIR,
      'review_src_quality_claude@1.1.json',
    );
    const originalData: ReviewFullJsonOutput = {
      adapter: 'claude',
      timestamp: '2024-01-01T00:00:00Z',
      status: 'fail',
      rawOutput: '',
      violations: [
        {
          file: 'src/foo.ts',
          line: 10,
          issue: 'Missing null check',
          status: 'new',
        },
        {
          file: 'src/bar.ts',
          line: 20,
          issue: 'Unused import',
          status: 'new',
        },
      ],
    };
    await fs.writeFile(jsonPath, JSON.stringify(originalData));

    // Enumerate to find the ID
    const violations = await enumerateNewViolations(TEST_DIR);
    expect(violations).toHaveLength(2);

    // Simulate fixing violation #1
    const target = violations[0]!;
    const content = await fs.readFile(target.jsonPath, 'utf-8');
    const data: ReviewFullJsonOutput = JSON.parse(content);
    const violation = data.violations[target.violationIndex]!;
    violation.status = 'fixed';
    violation.result = 'Added error handling';
    await fs.writeFile(target.jsonPath, JSON.stringify(data, null, 2));

    // Verify the file was updated
    const updated = JSON.parse(
      await fs.readFile(jsonPath, 'utf-8'),
    ) as ReviewFullJsonOutput;
    expect(updated.violations[0]!.status).toBe('fixed');
    expect(updated.violations[0]!.result).toBe('Added error handling');
    expect(updated.violations[1]!.status).toBe('new');

    // After fix, enumerate should only show 1 violation
    const remainingViolations = await enumerateNewViolations(TEST_DIR);
    expect(remainingViolations).toHaveLength(1);
    expect(remainingViolations[0]!.id).toBe(1); // Re-numbered from 1
    expect(remainingViolations[0]!.file).toBe('src/bar.ts');
  });

  it('marking a violation as skipped mutates the JSON file', async () => {
    const jsonPath = path.join(
      TEST_DIR,
      'review_src_quality_claude@1.1.json',
    );
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          {
            file: 'src/foo.ts',
            line: 10,
            issue: 'Stylistic issue',
            status: 'new',
          },
        ],
      }),
    );

    const violations = await enumerateNewViolations(TEST_DIR);
    const target = violations[0]!;

    const content = await fs.readFile(target.jsonPath, 'utf-8');
    const data: ReviewFullJsonOutput = JSON.parse(content);
    const violation = data.violations[target.violationIndex]!;
    violation.status = 'skipped';
    violation.result = 'Stylistic preference';
    await fs.writeFile(target.jsonPath, JSON.stringify(data, null, 2));

    const updated = JSON.parse(
      await fs.readFile(jsonPath, 'utf-8'),
    ) as ReviewFullJsonOutput;
    expect(updated.violations[0]!.status).toBe('skipped');
    expect(updated.violations[0]!.result).toBe('Stylistic preference');

    // No more new violations
    const remaining = await enumerateNewViolations(TEST_DIR);
    expect(remaining).toHaveLength(0);
  });

  it('records correct violationIndex for each violation', async () => {
    const jsonPath = path.join(
      TEST_DIR,
      'review_src_quality_claude@1.1.json',
    );
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          { file: 'a.ts', line: 1, issue: 'A', status: 'fixed' },
          { file: 'b.ts', line: 2, issue: 'B', status: 'new' },
          { file: 'c.ts', line: 3, issue: 'C', status: 'skipped' },
          { file: 'd.ts', line: 4, issue: 'D', status: 'new' },
        ],
      }),
    );

    const violations = await enumerateNewViolations(TEST_DIR);
    expect(violations).toHaveLength(2);

    // The first new violation (B) is at index 1 in the original array
    expect(violations[0]!.violationIndex).toBe(1);
    expect(violations[0]!.file).toBe('b.ts');

    // The second new violation (D) is at index 3 in the original array
    expect(violations[1]!.violationIndex).toBe(3);
    expect(violations[1]!.file).toBe('d.ts');
  });
});
