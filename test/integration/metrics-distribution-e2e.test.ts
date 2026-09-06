import { expect, test } from 'bun:test';
import { access } from 'node:fs/promises';
import path from 'node:path';

test('built CLI runs metrics capabilities under Node and ships contract assets', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const node = Bun.which('node');
  expect(node).toBeTruthy();
  await access(path.join(root, 'contracts/validator-metrics/v1/capabilities.schema.json'));
  await access(path.join(root, 'contracts/model-metrics/v1/export-record.schema.json'));

  const child = Bun.spawn({
    cmd: [node!, path.join(root, 'dist/index.js'), 'metrics', 'capabilities'],
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
  });
});
