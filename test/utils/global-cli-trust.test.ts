import { afterEach, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/loader.js';
import { buildTrustRecord } from '../../src/utils/trust-ledger.js';

let root: string;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

it('changes inherited trust config hash, but not a project override hash', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-cli-trust-'));
  const configDir = path.join(root, '.validator');
  await fs.mkdir(configDir);
  const projectPath = path.join(configDir, 'config.yml');
  const globalPath = path.join(root, 'global.yml');
  await fs.writeFile(projectPath, 'entry_points:\n  - path: src\n');
  const record = async (tool: string) => {
    await fs.writeFile(globalPath, `cli:\n  default_preference: [${tool}]\n`);
    return buildTrustRecord({ config: await loadConfig(root, { globalConfigPath: globalPath }), command: 'run', source: 'validated', status: 'passed', trusted: true, commit: null, tree: 'same-tree' }).config_hash;
  };
  expect(await record('codex')).not.toBe(await record('claude'));
  await fs.writeFile(projectPath, 'cli:\n  default_preference: [codex]\nentry_points:\n  - path: src\n');
  expect(await record('codex')).toBe(await record('claude'));
});
