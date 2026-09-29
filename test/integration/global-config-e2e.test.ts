import { afterEach, describe, expect, it } from 'bun:test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { initGitRepo, isDistBuilt, spawnValidator } from './helpers.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture(config: string, legacy = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-global-e2e-'));
  roots.push(root);
  const project = path.join(root, legacy ? '.gauntlet' : '.validator');
  const home = path.join(root, 'home');
  const globalPath = path.join(home, '.config', 'agent-validator', 'config.yml');
  const configPath = path.join(project, 'config.yml');
  await fs.mkdir(project);
  await fs.mkdir(path.dirname(globalPath), { recursive: true });
  await fs.writeFile(configPath, config);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: undefined, AGENT_VALIDATOR_REVIEWER_CLI: undefined, AGENT_VALIDATOR_REVIEWER_MODEL: undefined, AGENT_VALIDATOR_REVIEWER_EFFORT: undefined };
  return { root, project, home, globalPath, configPath, env };
}

async function makeStub(root: string, env: NodeJS.ProcessEnv) {
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls.jsonl');
  await fs.mkdir(bin);
  for (const name of ['codex', 'claude']) {
    const file = path.join(bin, name);
    await fs.writeFile(file, `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.STUB_CALLS, JSON.stringify({tool:'${name}', argv:process.argv.slice(2)})+'\\n');\nprocess.stdout.write('${name}' === 'claude' ? JSON.stringify({status:'pass'})+'\\n' : JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({status:'pass'})}})+'\\n');\n`);
    await fs.chmod(file, 0o755);
  }
  env.PATH = `${bin}:${process.env.PATH ?? ''}`;
  env.STUB_CALLS = calls;
  return async () => (await fs.readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { tool: string; argv: string[] });
}

const projectNoCli = `base_branch: base
log_dir: validator_logs
allow_parallel: false
entry_points:
  - path: "."
    checks:
      - simple:
          command: "true"
    reviews:
      - plain:
          builtin: code-quality
          parallel: false
      - pinned:
          builtin: security
          model: gpt-5.3-codex
          parallel: false
`;

describe('built binary global CLI config', () => {
  it('E2E-001: inherits, replaces, and overlays adapter models', async () => {
    if (!isDistBuilt()) return;
    const f = await fixture(projectNoCli);
    await fs.writeFile(path.join(f.root, 'app.ts'), 'export const value = 1;\n');
    await initGitRepo(f.root);
    await execFileAsync('git', ['branch', 'base'], { cwd: f.root });
    await fs.writeFile(path.join(f.root, 'app.ts'), 'export const value = 2;\n');
    const calls = await makeStub(f.root, f.env);
    const globalBytes = 'cli:\n  default_preference: [codex]\n  adapters:\n    codex:\n      model: gpt-6-sol\n      thinking_budget: low\n      allow_tool_use: false\n';
    await fs.writeFile(f.globalPath, globalBytes);
    const validate = await spawnValidator(['validate'], { cwd: f.root, env: f.env });
    expect(validate.exitCode).toBe(0);
    expect(validate.stdout).toContain(`${f.globalPath} (global config)`);
    const first = await spawnValidator(['run'], { cwd: f.root, env: f.env, timeoutMs: 60_000 });
    expect(first.exitCode).toBe(0);
    const firstCalls = await calls();
    expect(firstCalls.some((call) => call.tool === 'codex')).toBe(true);
    expect(firstCalls.every((call) => call.argv.join(' ').includes('gpt-6-sol'))).toBe(true);
    await fs.writeFile(f.configPath, projectNoCli.replace('entry_points:', 'cli:\n  default_preference: [claude]\nentry_points:'));
    const projectValidate = await spawnValidator(['validate'], { cwd: f.root, env: f.env });
    expect(projectValidate.stdout).toContain(`${f.configPath} (project config)`);
    const second = await spawnValidator(['run'], { cwd: f.root, env: f.env, timeoutMs: 60_000 });
    expect(`${second.exitCode}: ${second.stdout} ${second.stderr}`).toStartWith("0:");
    expect((await calls()).some((call) => call.tool === 'claude')).toBe(true);
    await fs.writeFile(f.configPath, projectNoCli.replace('entry_points:', 'cli:\n  default_preference: [codex]\n  adapters:\n    codex:\n      thinking_budget: high\nentry_points:'));
    const beforeThird = (await calls()).length;
    const third = await spawnValidator(['run'], { cwd: f.root, env: f.env, timeoutMs: 60_000 });
    expect(third.exitCode).toBe(0);
    const thirdCalls = (await calls()).slice(beforeThird);
    expect(thirdCalls.length).toBeGreaterThan(0);
    expect(thirdCalls.every((call) => call.argv.join(' ').includes('high'))).toBe(true);
    expect(thirdCalls.some((call) => call.argv.join(' ').includes('gpt-5.3-codex'))).toBe(true);
    expect(thirdCalls.every((call) => !call.argv.join(' ').includes('gpt-6-sol'))).toBe(true);
    await fs.writeFile(f.configPath, projectNoCli);
    const overrideEnv = { ...f.env, AGENT_VALIDATOR_REVIEWER_CLI: 'codex', AGENT_VALIDATOR_REVIEWER_MODEL: 'gpt-7' };
    const beforeOverride = (await calls()).length;
    const overridden = await spawnValidator(['run'], { cwd: f.root, env: overrideEnv, timeoutMs: 60_000 });
    expect(overridden.exitCode).toBe(0);
    const overrideCalls = (await calls()).slice(beforeOverride);
    expect(overrideCalls.length).toBeGreaterThan(0);
    expect(overrideCalls.every((call) => call.argv.join(' ').includes('gpt-7'))).toBe(true);
    expect(await fs.readFile(f.globalPath, 'utf8')).toBe(globalBytes);
  }, 30_000);

  it('E2E-002: rejects a malformed global file for every command before side effects', async () => {
    if (!isDistBuilt()) return;
    const f = await fixture(projectNoCli.replace('entry_points:', 'cli:\n  default_preference: [codex]\nentry_points:').replace('command: "true"', 'command: "touch check-marker"'));
    await fs.writeFile(path.join(f.root, 'app.ts'), 'export const value = 1;\n');
    await initGitRepo(f.root);
    await execFileAsync('git', ['branch', 'base'], { cwd: f.root });
    await fs.writeFile(path.join(f.root, 'app.ts'), 'export const value = 2;\n');
    await makeStub(f.root, f.env);
    await fs.writeFile(f.globalPath, 'cli: [');
    for (const command of [['run'], ['check'], ['validate'], ['health'], ['skip'], ['clean']]) {
      const result = await spawnValidator(command, { cwd: f.root, env: f.env, timeoutMs: 60_000 });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(f.globalPath);
    }
    expect(await fs.readdir(f.root)).not.toContain('validator_logs');
    expect(await fs.readdir(f.root)).not.toContain('check-marker');
    await fs.writeFile(f.globalPath, 'debug_log:\n  enabled: yes\n');
    const schemaInvalid = await spawnValidator(['validate'], { cwd: f.root, env: f.env });
    expect(schemaInvalid.exitCode).not.toBe(0);
    expect(schemaInvalid.stdout + schemaInvalid.stderr).toContain('debug_log.enabled');
    await fs.writeFile(f.globalPath, 'cli: [');
    const empty = path.join(f.root, 'empty');
    await fs.mkdir(empty);
    const clean = await spawnValidator(['clean'], { cwd: empty, env: f.env });
    expect(clean.exitCode).not.toBe(0);
    expect(clean.stdout + clean.stderr).toContain(f.globalPath);
    await fs.writeFile(f.globalPath, 'debug_log:\n  enabled: true\n');
    const valid = await spawnValidator(['run'], { cwd: f.root, env: f.env, timeoutMs: 60_000 });
    expect(valid.exitCode).toBe(0);
    expect(await fs.readdir(f.root)).toContain('check-marker');
    expect(await fs.readdir(path.join(f.root, 'validator_logs'))).toContain('.debug.log');
  });

  it('E2E-003: lists CI jobs without CLI and reports both missing paths', async () => {
    if (!isDistBuilt()) return;
    const f = await fixture('entry_points:\n  - path: "."\n    checks: [simple]\n');
    await fs.writeFile(path.join(f.project, 'checks.yml'), '');
    await fs.mkdir(path.join(f.project, 'checks'));
    await fs.writeFile(path.join(f.project, 'checks', 'simple.yml'), 'command: "true"\n');
    await fs.writeFile(path.join(f.project, 'ci.yml'), 'checks:\n  - name: simple\n');
    const jobs = await spawnValidator(['ci', 'list-jobs'], { cwd: f.root, env: f.env });
    expect(`${jobs.exitCode}: ${jobs.stdout} ${jobs.stderr}`).toStartWith("0:");
    expect(JSON.parse(jobs.stdout).matrix).toHaveLength(1);
    for (const command of [['run'], ['validate']]) {
      const result = await spawnValidator(command, { cwd: f.root, env: f.env });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(f.configPath);
      expect(result.stdout + result.stderr).toContain(f.globalPath);
    }
    await fs.writeFile(f.globalPath, 'cli: [');
    const invalid = await spawnValidator(['ci', 'list-jobs'], { cwd: f.root, env: f.env });
    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stdout + invalid.stderr).toContain(f.globalPath);
    const legacy = await fixture('entry_points:\n  - path: src\n', true);
    const result = await spawnValidator(['validate'], { cwd: legacy.root, env: legacy.env });
    expect(result.stdout + result.stderr).toContain(legacy.configPath);
    expect(result.stdout + result.stderr).toContain(legacy.globalPath);
  });
});
