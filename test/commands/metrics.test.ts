import { expect, test } from 'bun:test';
import path from 'node:path';

test('metrics capabilities is config-independent structured JSON', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(root, 'src/index.ts'), 'metrics', 'capabilities'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({
    ok: true,
    operation: 'capabilities',
    protocol_version: 1,
    capabilities_version: 1,
  });
});

test('metrics argument failures remain one structured stdout response', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(root, 'src/index.ts'), 'metrics', 'export'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  expect(await child.exited).toBe(1);
  expect(JSON.parse(stdout)).toMatchObject({
    ok: false,
    operation: 'export',
    error: { code: 'invalid_arguments' },
  });
});
