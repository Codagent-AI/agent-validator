import { afterEach, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/loader.js';
import { REVIEWER_CLI_ENV } from '../../src/config/reviewer-override.js';

let root: string;
const original = process.env[REVIEWER_CLI_ENV];
afterEach(async () => {
  if (original === undefined) delete process.env[REVIEWER_CLI_ENV];
  else process.env[REVIEWER_CLI_ENV] = original;
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it('overlays the inherited block without writing or merging it into a project override', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-global-overlay-'));
  const dir = path.join(root, '.validator');
  await fs.mkdir(dir);
  const projectPath = path.join(dir, 'config.yml');
  const globalPath = path.join(root, 'global.yml');
  await fs.writeFile(projectPath, 'entry_points:\n  - path: src\n');
  const globalBytes = 'cli:\n  default_preference: [codex]\n  adapters:\n    claude:\n      allow_tool_use: true\n';
  await fs.writeFile(globalPath, globalBytes);
  process.env[REVIEWER_CLI_ENV] = 'claude';
  const inherited = await loadConfig(root, { globalConfigPath: globalPath, applyReviewerOverride: true });
  expect(inherited.project.cli.default_preference).toEqual(['claude']);
  expect(inherited.project.cli.adapters?.claude?.allow_tool_use).toBe(true);
  expect(inherited.globalConfig.cli?.default_preference).toEqual(['codex']);
  expect(await fs.readFile(globalPath, 'utf8')).toBe(globalBytes);
  await fs.writeFile(projectPath, 'cli:\n  default_preference: [codex]\nentry_points:\n  - path: src\n');
  const replaced = await loadConfig(root, { globalConfigPath: globalPath, applyReviewerOverride: true });
  expect(replaced.project.cli.adapters?.claude?.allow_tool_use).toBe(false);
  await fs.writeFile(globalPath, 'debug_log:\n  enabled: false\n');
  await fs.writeFile(projectPath, 'entry_points:\n  - path: src\n');
  await expect(loadConfig(root, { globalConfigPath: globalPath, applyReviewerOverride: true })).rejects.toThrow('No "cli" block found');
});
