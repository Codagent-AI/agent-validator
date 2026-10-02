import { expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

it('loads global config only in the loader and missing-project clean path', async () => {
  const root = path.resolve(import.meta.dir, '../../src');
  const callers: string[] = [];
  async function scan(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.name.endsWith('.ts') && !file.endsWith('/config/global.ts') && /\bloadGlobalConfig\s*\(/.test(await fs.readFile(file, 'utf8'))) {
        callers.push(path.relative(root, file));
      }
    }
  }
  await scan(root);
  expect(callers.sort()).toEqual(['commands/clean.ts', 'config/loader.ts']);
});
