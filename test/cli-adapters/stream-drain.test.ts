import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GitHubCopilotAdapter } from '../../src/cli-adapters/github-copilot.js';
import { AdapterExecutionFailure } from '../../src/cli-adapters/shared.js';
import { runStreamingCommand } from '../../src/cli-adapters/shared.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

test('Copilot timeout retains a summary flushed during graceful termination', async () => {
  const node = Bun.which('node');
  expect(node).toBeTruthy();
  const summary = 'Total usage est: 1 Premium request\n model-a 10 in, 3 out, 0 cached\n';
  const controlledSpawn: typeof spawn = ((...args: Parameters<typeof spawn>) => spawn(node!, ['-e', `process.on('SIGTERM',()=>{process.stdout.write(${JSON.stringify(summary)});process.exit(0)});setInterval(()=>{},1000)`], args[2])) as typeof spawn;
  const adapter = Reflect.construct(GitHubCopilotAdapter, [controlledSpawn]) as GitHubCopilotAdapter;
  expect((adapter as unknown as { spawnCommand: unknown }).spawnCommand).toBe(controlledSpawn);
  try {
    await adapter.execute({prompt:'synthetic',diff:'',timeoutMs:1000});
    throw new Error('expected timeout');
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterExecutionFailure);
    expect((error as Error).message).toBe('Command timed out');
    expect((error as AdapterExecutionFailure).telemetry.tokens.output.value).toBe(3);
  }
});

test('timeout drains final provider output and collects it before cleanup and rejection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'validator-drain-'));
  directories.push(directory);
  const prompt = path.join(directory, 'prompt.txt');
  await writeFile(prompt, 'synthetic');
  const events: string[] = [];
  const node = Bun.which('node');
  expect(node).toBeTruthy();
  const options = {
    command: node!, args: ['-e', "process.on('SIGTERM',()=>{process.stdout.write('final-usage\\n');process.exit(0)});process.stdout.write('ready\\n');setInterval(()=>{},1000)"],
    tmpFile: prompt, timeoutMs: 1000,
    onStdout: (chunk: string) => events.push(chunk.trim()),
    onCollected: (stdout: string) => { events.push(`collected:${stdout.trim()}`); },
    cleanup: async () => { events.push('cleanup'); },
  };
  await expect(runStreamingCommand(options)).rejects.toThrow('Command timed out');
  expect(events).toEqual(['ready', 'final-usage', 'collected:ready\nfinal-usage', 'cleanup']);
});
