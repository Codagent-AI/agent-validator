import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { getAllAdapters } from '../../src/cli-adapters/index.js';
import { registerHealthCommand } from '../../src/commands/health.js';
import { getGlobalConfigPath, setGlobalConfigPathForTests } from '../../src/config/global.js';

const originalCwd = process.cwd();
const preloadedPath = getGlobalConfigPath();
const originalLog = console.log;
const originalError = console.error;
const healthMethods = getAllAdapters().map((adapter) => [adapter, adapter.checkHealth] as const);
let root: string;

afterEach(async () => {
  process.chdir(originalCwd);
  setGlobalConfigPathForTests(preloadedPath);
  console.log = originalLog;
  console.error = originalError;
  for (const [adapter, method] of healthMethods) adapter.checkHealth = method;
  process.exitCode = 0;
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const states = [
  { name: 'malformed global with valid project', project: 'cli:\n  default_preference: [codex]\nentry_points:\n  - path: src\n', global: 'cli: [', fail: true, fallback: false },
  { name: 'missing CLI', project: 'entry_points:\n  - path: src\n', fail: true, fallback: false },
  { name: 'inherited healthy CLI', project: 'entry_points:\n  - path: src\n', global: 'cli:\n  default_preference: [codex]\n', fail: false, fallback: false },
  { name: 'no project', fail: false, fallback: true },
  { name: 'no project and malformed global', global: 'cli: [', fail: true, fallback: true },
  { name: 'invalid project YAML', project: 'cli: [', fail: true, fallback: false },
  { name: 'empty project CLI', project: 'cli: {}\nentry_points:\n  - path: src\n', fail: true, fallback: false },
  { name: 'invalid inherited tool', project: 'entry_points:\n  - path: src\n', global: 'cli:\n  default_preference: [not-a-tool]\n', fail: true, fallback: false },
] as const;

describe.serial('health configuration exit matrix', () => {
  for (const state of states) it(state.name, async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-health-global-'));
    const globalPath = path.join(root, 'home', 'config.yml');
    setGlobalConfigPathForTests(globalPath);
    if ('project' in state) {
      await fs.mkdir(path.join(root, '.validator'));
      await fs.writeFile(path.join(root, '.validator', 'config.yml'), state.project);
    }
    if ('global' in state) {
      await fs.mkdir(path.dirname(globalPath));
      await fs.writeFile(globalPath, state.global);
    }
    for (const adapter of getAllAdapters()) adapter.checkHealth = async () => ({ status: 'healthy', available: true });
    const lines: string[] = [];
    console.log = (...args) => { lines.push(args.join(' ')); };
    console.error = (...args) => { lines.push(args.join(' ')); };
    process.chdir(root);
    const command = new Command();
    registerHealthCommand(command);
    await command.parseAsync(['health'], { from: 'user' });
    const output = lines.join('\n');
    expect(process.exitCode).toBe(state.fail ? 1 : 0);
    expect(output.includes('Config not found, checking all supported agents')).toBe(state.fallback);
    if ('global' in state) expect(output).toContain('config.yml');
    if (state.name === 'missing CLI') expect(output).toContain(globalPath);
  });
});
