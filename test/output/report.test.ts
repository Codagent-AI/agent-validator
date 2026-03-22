import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GateResult } from '../../src/gates/result.js';
import {
  enumerateNewViolations,
  generateReport,
} from '../../src/output/report.js';

const TEST_DIR = path.join(import.meta.dir, '../../.test-report');

beforeEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe('enumerateNewViolations', () => {
  it('assigns sequential IDs to "new" violations', async () => {
    await fs.writeFile(
      path.join(TEST_DIR, 'review_src_quality_claude@1.1.json'),
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          {
            file: 'src/foo.ts',
            line: 10,
            issue: 'Missing null check',
            fix: 'Add null guard',
            priority: 'high',
            status: 'new',
          },
          {
            file: 'src/bar.ts',
            line: 20,
            issue: 'Unused import',
            status: 'new',
          },
        ],
      }),
    );

    const violations = await enumerateNewViolations(TEST_DIR);
    expect(violations).toHaveLength(2);
    expect(violations[0]!.id).toBe(1);
    expect(violations[0]!.file).toBe('src/foo.ts');
    expect(violations[0]!.line).toBe(10);
    expect(violations[0]!.issue).toBe('Missing null check');
    expect(violations[0]!.fix).toBe('Add null guard');
    expect(violations[0]!.priority).toBe('high');
    expect(violations[0]!.gateLabel).toBe('review_src_quality');
    expect(violations[0]!.adapterSuffix).toBe('claude@1');

    expect(violations[1]!.id).toBe(2);
    expect(violations[1]!.file).toBe('src/bar.ts');
  });

  it('excludes violations with status "fixed" or "skipped"', async () => {
    await fs.writeFile(
      path.join(TEST_DIR, 'review_src_quality_claude@1.1.json'),
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          {
            file: 'src/a.ts',
            line: 1,
            issue: 'Issue A',
            status: 'fixed',
          },
          {
            file: 'src/b.ts',
            line: 2,
            issue: 'Issue B',
            status: 'new',
          },
          {
            file: 'src/c.ts',
            line: 3,
            issue: 'Issue C',
            status: 'skipped',
          },
        ],
      }),
    );

    const violations = await enumerateNewViolations(TEST_DIR);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.id).toBe(1);
    expect(violations[0]!.file).toBe('src/b.ts');
  });

  it('assigns sequential IDs across multiple JSON files in sorted order', async () => {
    // File "aaa" comes before "bbb" alphabetically
    await fs.writeFile(
      path.join(TEST_DIR, 'review_src_aaa_claude@1.1.json'),
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          { file: 'src/a.ts', line: 1, issue: 'Issue A', status: 'new' },
          { file: 'src/b.ts', line: 2, issue: 'Issue B', status: 'new' },
        ],
      }),
    );

    await fs.writeFile(
      path.join(TEST_DIR, 'review_src_bbb_claude@1.1.json'),
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          { file: 'src/c.ts', line: 3, issue: 'Issue C', status: 'new' },
          { file: 'src/d.ts', line: 4, issue: 'Issue D', status: 'new' },
          { file: 'src/e.ts', line: 5, issue: 'Issue E', status: 'new' },
        ],
      }),
    );

    const violations = await enumerateNewViolations(TEST_DIR);
    expect(violations).toHaveLength(5);
    expect(violations[0]!.id).toBe(1);
    expect(violations[1]!.id).toBe(2);
    expect(violations[2]!.id).toBe(3);
    expect(violations[3]!.id).toBe(4);
    expect(violations[4]!.id).toBe(5);

    // Verify no gaps
    for (let i = 0; i < violations.length; i++) {
      expect(violations[i]!.id).toBe(i + 1);
    }
  });

  it('returns empty array when no log directory exists', async () => {
    const violations = await enumerateNewViolations('/nonexistent/dir');
    expect(violations).toHaveLength(0);
  });

  it('returns empty array when no JSON files exist', async () => {
    const violations = await enumerateNewViolations(TEST_DIR);
    expect(violations).toHaveLength(0);
  });

  it('treats violations without explicit status as "new"', async () => {
    await fs.writeFile(
      path.join(TEST_DIR, 'review_src_quality_claude@1.1.json'),
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          {
            file: 'src/foo.ts',
            line: 10,
            issue: 'Missing check',
            // No status field
          },
        ],
      }),
    );

    const violations = await enumerateNewViolations(TEST_DIR);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.id).toBe(1);
  });
});

describe('generateReport', () => {
  it('returns status line only when all gates pass', async () => {
    const gateResults: GateResult[] = [
      { jobId: 'check:src:lint', status: 'pass', duration: 1000 },
    ];

    const report = await generateReport('passed', gateResults, TEST_DIR);
    expect(report).toBe('Status: Passed');
  });

  it('returns "Passed with warnings" status for passed_with_warnings', async () => {
    const gateResults: GateResult[] = [
      { jobId: 'check:src:lint', status: 'pass', duration: 1000 },
    ];

    const report = await generateReport(
      'passed_with_warnings',
      gateResults,
      TEST_DIR,
    );
    expect(report).toBe('Status: Passed with warnings');
  });

  it('includes check failure metadata but not parsed error output', async () => {
    const gateResults: GateResult[] = [
      {
        jobId: 'check:src:lint',
        status: 'fail',
        duration: 1000,
        command: 'bun run lint',
        workingDirectory: '/project/src',
        fixInstructions: 'Run `bun run lint --fix`',
        fixWithSkill: 'lint-fixer',
        logPath: 'validator_logs/check_src_lint.1.log',
      },
    ];

    const report = await generateReport('failed', gateResults, TEST_DIR);

    expect(report).toContain('Status: Failed');
    expect(report).toContain('## CHECK FAILURES');
    expect(report).toContain('### check:src:lint');
    expect(report).toContain('Command: bun run lint');
    expect(report).toContain('Directory: /project/src');
    expect(report).toContain('Fix instructions: Run `bun run lint --fix`');
    expect(report).toContain('Fix skill: lint-fixer');
    expect(report).toContain('Log: validator_logs/check_src_lint.1.log');
  });

  it('includes review violations with numeric IDs', async () => {
    await fs.writeFile(
      path.join(TEST_DIR, 'review_src_quality_claude@1.1.json'),
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          {
            file: 'src/foo.ts',
            line: 10,
            issue: 'Missing null check',
            fix: 'Add null guard',
            priority: 'high',
            status: 'new',
          },
        ],
      }),
    );

    const gateResults: GateResult[] = [
      {
        jobId: 'review:src:quality',
        status: 'fail',
        duration: 5000,
      },
    ];

    const report = await generateReport('failed', gateResults, TEST_DIR);

    expect(report).toContain('## REVIEW VIOLATIONS');
    expect(report).toContain('#1 [high] review_src_quality (claude@1)');
    expect(report).toContain('  src/foo.ts:10 - Missing null check');
    expect(report).toContain('  Fix: Add null guard');
    expect(report).toContain('  JSON:');
  });

  it('contains no ANSI escape codes', async () => {
    await fs.writeFile(
      path.join(TEST_DIR, 'review_src_quality_claude@1.1.json'),
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          {
            file: 'src/foo.ts',
            line: 10,
            issue: 'Issue',
            status: 'new',
            priority: 'high',
          },
        ],
      }),
    );

    const gateResults: GateResult[] = [
      {
        jobId: 'check:src:lint',
        status: 'fail',
        duration: 1000,
        command: 'bun run lint',
        workingDirectory: '/project/src',
        logPath: 'validator_logs/check.1.log',
      },
    ];

    const report = await generateReport('failed', gateResults, TEST_DIR);

    // ANSI escape codes start with \x1B[ or \u001B[
    // eslint-disable-next-line no-control-regex
    const ansiRegex = /\u001B\[/;
    expect(ansiRegex.test(report)).toBe(false);
  });

  it('excludes non-new violations from report', async () => {
    await fs.writeFile(
      path.join(TEST_DIR, 'review_src_quality_claude@1.1.json'),
      JSON.stringify({
        adapter: 'claude',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'fail',
        rawOutput: '',
        violations: [
          { file: 'src/a.ts', line: 1, issue: 'Fixed issue', status: 'fixed' },
          {
            file: 'src/b.ts',
            line: 2,
            issue: 'Skipped issue',
            status: 'skipped',
          },
          { file: 'src/c.ts', line: 3, issue: 'New issue', status: 'new' },
        ],
      }),
    );

    const gateResults: GateResult[] = [
      { jobId: 'review:src:quality', status: 'fail', duration: 1000 },
    ];

    const report = await generateReport('failed', gateResults, TEST_DIR);

    expect(report).toContain('#1');
    expect(report).toContain('src/c.ts:3');
    expect(report).not.toContain('src/a.ts');
    expect(report).not.toContain('src/b.ts');
    expect(report).not.toContain('#2');
  });

  it('returns status line only when no gate results', async () => {
    const report = await generateReport('passed', undefined, TEST_DIR);
    expect(report).toBe('Status: Passed');
  });
});
