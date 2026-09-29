import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_GLOBAL_CONFIG, getGlobalConfigPath, GlobalConfigError,
  loadGlobalConfig, readGlobalConfig, setGlobalConfigPathForTests,
} from '../../src/config/global.js';

let dir: string;
let preloadedPath: string;
beforeEach(async () => {
  preloadedPath = getGlobalConfigPath();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-global-'));
});
afterEach(async () => {
  setGlobalConfigPathForTests(preloadedPath);
  await fs.rm(dir, { recursive: true, force: true });
});

it('isolates the global config path for every in-process test', () => {
  expect(getGlobalConfigPath().startsWith(os.tmpdir())).toBe(true);
  expect(getGlobalConfigPath()).toEndWith('config.yml');
});

describe('global config reader', () => {
  it('uses defaults for missing and empty files', async () => {
    const file = path.join(dir, 'config.yml');
    expect(await readGlobalConfig(file)).toEqual({ status: 'missing', path: file });
    expect(await loadGlobalConfig(file)).toEqual(DEFAULT_GLOBAL_CONFIG);
    await fs.writeFile(file, '');
    expect(await loadGlobalConfig(file)).toEqual(DEFAULT_GLOBAL_CONFIG);
  });

  it('loads debug log and CLI blocks', async () => {
    const file = path.join(dir, 'config.yml');
    await fs.writeFile(file, 'debug_log:\n  enabled: true\ncli:\n  default_preference: [codex]\n  adapters:\n    codex:\n      model: gpt-test\n');
    const result = await readGlobalConfig(file);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.config.debug_log.enabled).toBe(true);
      expect(result.config.cli?.adapters?.codex?.model).toBe('gpt-test');
    }
  });

  it.each(['cli: [', 'debug_log:\n  enabled: yes\n'])(
    'reports an invalid file without falling back: %s', async (content) => {
      const file = path.join(dir, 'config.yml');
      await fs.writeFile(file, content);
      const result = await readGlobalConfig(file);
      expect(result.status).toBe('invalid');
      expect(result.status === 'invalid' && result.issues.length).toBeGreaterThan(0);
      try {
        await loadGlobalConfig(file);
        throw new Error('expected load to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(GlobalConfigError);
        expect((error as GlobalConfigError).path).toBe(file);
        expect((error as Error).message).toContain(file);
      }
    },
  );
});
