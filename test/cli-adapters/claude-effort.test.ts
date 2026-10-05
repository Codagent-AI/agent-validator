import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClaudeAdapter } from '../../src/cli-adapters/claude.js';
import { AdapterExecutionFailure } from '../../src/cli-adapters/shared.js';

type Capture = { argv: string[]; effort: string | null; tokens: string | null };

describe('INT-001: Claude effort launch and telemetry', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let dir: string;
  let captureFile: string;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-claude-effort-'));
    captureFile = path.join(dir, 'capture.jsonl');
    await fs.writeFile(path.join(dir, 'claude'), `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CLAUDE_CAPTURE_FILE, JSON.stringify({
  argv,
  effort: process.env.CLAUDE_CODE_EFFORT_LEVEL ?? null,
  tokens: process.env.MAX_THINKING_TOKENS ?? null,
}) + '\\n');
if (argv.includes('--effort')) {
  process.stderr.write('unknown option --effort\\n');
  process.exit(2);
}
if (process.env.FAKE_CLAUDE_FAIL === '1') {
  process.stderr.write('simulated failure\\n');
  process.exit(3);
}
process.stdout.write(JSON.stringify({ status: 'pass' }) + '\\n');
`);
    await fs.chmod(path.join(dir, 'claude'), 0o755);
    process.env.PATH = `${dir}:${originalEnv.PATH ?? ''}`;
    process.env.FAKE_CLAUDE_CAPTURE_FILE = captureFile;
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
    delete process.env.MAX_THINKING_TOKENS;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function capture(): Promise<Capture> {
    const records = (await fs.readFile(captureFile, 'utf8')).trim().split('\n');
    return JSON.parse(records.at(-1) ?? '{}') as Capture;
  }

  async function run(thinkingBudget?: string) {
    return new ClaudeAdapter().execute({ prompt: 'Review', diff: 'change', thinkingBudget });
  }

  it.each([
    ['low', 'low', '8000'],
    ['medium', 'medium', '16000'],
    ['high', 'high', '31999'],
    ['off', null, '0'],
    [undefined, null, null],
  ] as const)('launches budget %s with matching identity', async (budget, effort, tokens) => {
    const result = await run(budget);
    const child = await capture();
    expect(child).toMatchObject({ effort, tokens });
    expect(child.argv).not.toContain('--effort');
    expect(result.telemetry.requested_identity.effort).toBe(budget ?? null);
    expect(result.telemetry.resolved_identity.effort).toBe(effort);
    expect(result.telemetry.resolved_identity.provenance).toBe('launch_resolution');
    expect(result.telemetry.observed_identities).toEqual([]);
  });

  it.each([
    ['medium', 'medium'],
    ['MEDIUM', 'medium'],
    ['auto', null],
    [' medium ', null],
    ['med', null],
  ] as const)('passes inherited %s through unchanged', async (inherited, resolved) => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = inherited;
    process.env.MAX_THINKING_TOKENS = '123';
    const result = await run();
    expect(await capture()).toMatchObject({ effort: inherited, tokens: '123' });
    expect(result.telemetry.requested_identity.effort).toBeNull();
    expect(result.telemetry.resolved_identity.effort).toBe(resolved);
    expect(result.telemetry.resolved_identity.provenance).toBe('launch_resolution');
  });

  it('lets configured low override inherited high', async () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'high';
    const result = await run('low');
    expect(await capture()).toMatchObject({ effort: 'low', tokens: '8000' });
    expect(result.telemetry.resolved_identity.effort).toBe('low');
  });

  it.each([true, false])('disallows findings tools with allowToolUse=%s', async (allowToolUse) => {
    await new ClaudeAdapter().execute({ prompt: 'Review', diff: 'change', allowToolUse });
    const { argv } = await capture();
    const deniedIndex = argv.indexOf('--disallowedTools');
    expect(deniedIndex).toBeGreaterThanOrEqual(0);
    expect(argv[deniedIndex + 1]?.split(',')).toContain('ReportFindings');
    expect(argv[argv.indexOf('--allowedTools') + 1]).toBe(
      allowToolUse ? 'Read,Glob,Grep,Task' : 'Task',
    );
  });

  it('retains launch effort on process failure', async () => {
    process.env.FAKE_CLAUDE_FAIL = '1';
    try {
      await run('low');
      throw new Error('expected Claude to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterExecutionFailure);
      const failure = error as AdapterExecutionFailure;
      expect(failure.telemetry.requested_identity.effort).toBe('low');
      expect(failure.telemetry.resolved_identity.effort).toBe('low');
      expect(failure.telemetry.resolved_identity.provenance).toBe('launch_resolution');
      expect(await capture()).toMatchObject({ effort: 'low', tokens: '8000' });
    }
  });

  it('snapshots inherited effort before the first await', async () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'medium';
    const pending = run();
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'high';
    const result = await pending;
    expect((await capture()).effort).toBe('medium');
    expect(result.telemetry.resolved_identity.effort).toBe('medium');
  });
});
