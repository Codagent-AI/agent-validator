import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/loader.js';
import { validateConfig } from '../../src/config/validator.js';

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

interface Row {
  name: string;
  projectCli?: string;
  globalCli?: string;
  reviewPin?: string;
  legacy?: boolean;
  valid: boolean;
  source?: 'project' | 'global';
  errorFile?: 'project' | 'global' | 'review' | 'both';
  optional?: boolean;
}
const rows: Row[] = [
  { name: 'project replaces global', projectCli: '  default_preference: [claude]', globalCli: '  default_preference: [codex]', valid: true, source: 'project' },
  { name: 'project replaces semantically invalid global CLI', projectCli: '  default_preference: [claude]', globalCli: '  default_preference: [not-a-tool]', valid: true, source: 'project' },
  { name: 'global inheritance', globalCli: '  default_preference: [codex]', valid: true, source: 'global' },
  { name: 'empty project wins', projectCli: '  {}', globalCli: '  default_preference: [codex]', valid: false, errorFile: 'project', optional: true },
  { name: 'missing everywhere', valid: false, errorFile: 'both', optional: true },
  { name: 'invalid global tool', globalCli: '  default_preference: [not-a-tool]', valid: false, errorFile: 'global' },
  { name: 'review pin outside global', globalCli: '  default_preference: [codex]', reviewPin: 'claude', valid: false, errorFile: 'review' },
  { name: 'legacy missing everywhere', legacy: true, valid: false, errorFile: 'both' },
  { name: 'check only empty project', projectCli: '  {}', valid: false, errorFile: 'project', optional: true },
  { name: 'check only invalid global tool', globalCli: '  default_preference: [not-a-tool]', valid: false, errorFile: 'global', optional: true },
];

describe('runtime and structured CLI validation parity', () => {
  for (const row of rows) it(row.name, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-cli-parity-'));
    tempDirs.push(root);
    const configDir = path.join(root, row.legacy ? '.gauntlet' : '.validator');
    const projectPath = path.join(configDir, 'config.yml');
    const globalPath = path.join(root, 'home', 'config.yml');
    const reviewPath = path.join(configDir, 'reviews', 'sample.md');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(projectPath, `${row.projectCli !== undefined ? `cli:\n${row.projectCli}\n` : ''}entry_points:\n  - path: src\n${row.reviewPin ? '    reviews: [sample]\n' : ''}`);
    if (row.globalCli !== undefined) {
      await fs.mkdir(path.dirname(globalPath), { recursive: true });
      await fs.writeFile(globalPath, `cli:\n${row.globalCli}\n`);
    }
    if (row.reviewPin) {
      await fs.mkdir(path.dirname(reviewPath), { recursive: true });
      await fs.writeFile(reviewPath, `---\ncli_preference: [${row.reviewPin}]\n---\nReview.`);
    }
    const validation = await validateConfig(root, { globalConfigPath: globalPath });
    expect(validation.valid).toBe(row.valid);
    expect(validation.projectConfigFound).toBe(true);
    if (row.globalCli !== undefined) expect(validation.filesChecked).toContain(globalPath);
    let error: Error | undefined;
    let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
    try { config = await loadConfig(root, { globalConfigPath: globalPath }); }
    catch (caught) { error = caught as Error; }
    expect(!error).toBe(row.valid);
    if (row.valid) {
      expect(config?.cliSource?.kind).toBe(row.source);
      expect(config?.cliSource?.path).toBe(row.source === 'global' ? globalPath : projectPath);
      expect(config?.globalConfig.cli).toBeDefined();
    } else {
      const expected = row.errorFile === 'project' ? projectPath : row.errorFile === 'review' ? reviewPath : globalPath;
      if (row.errorFile === 'review') expect(validation.issues.some((issue) => issue.file === reviewPath)).toBe(true);
      else expect(validation.issues.some((issue) => issue.file === expected || (row.errorFile === 'both' && issue.message.includes(globalPath)))).toBe(true);
      if (row.errorFile === 'both') {
        expect(error?.message).toContain(projectPath);
        expect(error?.message).toContain(globalPath);
      } else expect(error?.message).toContain(row.reviewPin ?? expected);
    }
    if (row.optional) expect(await loadConfig(root, { globalConfigPath: globalPath, requireCli: false })).toBeDefined();
  });
});

it('does not merge adapter blocks and keeps a single global snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-cli-snapshot-'));
  tempDirs.push(root);
  const configDir = path.join(root, '.validator');
  const globalPath = path.join(root, 'global.yml');
  await fs.mkdir(configDir);
  await fs.writeFile(path.join(configDir, 'config.yml'), 'entry_points:\n  - path: src\n');
  await fs.writeFile(globalPath, 'cli:\n  adapters:\n    codex:\n      model: global-model\ndebug_log:\n  enabled: true\n');
  const inherited = await loadConfig(root, { globalConfigPath: globalPath });
  expect(inherited.project.cli.default_preference).toEqual(['codex']);
  expect(inherited.project.cli.adapters?.codex?.model).toBe('global-model');
  await fs.writeFile(globalPath, 'cli:\n  default_preference: [claude]\n');
  expect(inherited.globalConfig.cli?.adapters?.codex?.model).toBe('global-model');
  expect(inherited.globalConfig.debug_log.enabled).toBe(true);
  await fs.writeFile(path.join(configDir, 'config.yml'), 'cli:\n  default_preference: [codex]\nentry_points:\n  - path: src\n');
  const replaced = await loadConfig(root, { globalConfigPath: globalPath });
  expect(replaced.project.cli.adapters).toBeUndefined();
});

it('rejects an invalid global file even when project CLI is valid', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-cli-invalid-'));
  tempDirs.push(root);
  await fs.mkdir(path.join(root, '.validator'));
  await fs.writeFile(path.join(root, '.validator', 'config.yml'), 'cli:\n  default_preference: [codex]\nentry_points:\n  - path: src\n');
  const globalPath = path.join(root, 'global.yml');
  await fs.writeFile(globalPath, 'cli: [');
  await expect(loadConfig(root, { globalConfigPath: globalPath })).rejects.toThrow(globalPath);
});

describe('invalid global config with an inherited CLI block', () => {
  it('reports only the global error, matching runtime loading', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-cli-parity-'));
    tempDirs.push(root);
    const globalPath = path.join(root, 'home', 'config.yml');
    await fs.mkdir(path.join(root, '.validator'), { recursive: true });
    await fs.writeFile(path.join(root, '.validator', 'config.yml'), 'entry_points:\n  - path: src\n');
    await fs.mkdir(path.dirname(globalPath), { recursive: true });
    await fs.writeFile(globalPath, 'debug_log:\n  enabled: "yes"\ncli:\n  default_preference: [codex]\n');

    const validation = await validateConfig(root, { globalConfigPath: globalPath });
    const errors = validation.issues.filter((issue) => issue.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((issue) => issue.file === globalPath)).toBe(true);
    expect(errors.some((issue) => issue.message.includes('No "cli" block'))).toBe(false);
    expect(validation.globalConfigRead.status).toBe('invalid');
    await expect(loadConfig(root, { globalConfigPath: globalPath })).rejects.toThrow(`Invalid global config at ${globalPath}`);
  });
});

describe('reusing a global config read', () => {
  it('loads from the supplied read result instead of reading the file again', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-cli-parity-'));
    tempDirs.push(root);
    const globalPath = path.join(root, 'home', 'config.yml');
    await fs.mkdir(path.join(root, '.validator'), { recursive: true });
    await fs.writeFile(path.join(root, '.validator', 'config.yml'), 'entry_points:\n  - path: src\n');
    await fs.mkdir(path.dirname(globalPath), { recursive: true });
    await fs.writeFile(globalPath, 'cli:\n  default_preference: [codex]\n');

    const validation = await validateConfig(root, { globalConfigPath: globalPath });
    await fs.writeFile(globalPath, 'not: [valid');
    const config = await loadConfig(root, { globalConfigRead: validation.globalConfigRead });
    expect(config.project.cli.default_preference).toEqual(['codex']);
    expect(config.cliSource).toEqual({ kind: 'global', path: globalPath });
  });
});
