import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveMetricsLocation } from '../../src/config/metrics-location.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-location-'));
  directories.push(directory);
  return directory;
}

test('resolves only log location from an explicit config without loading invalid reviews', async () => {
  const root = await project();
  await mkdir(path.join(root, '.validator'));
  await writeFile(
    path.join(root, '.validator', 'config.yml'),
    'log_dir: retained-metrics\ncli: {}\nentry_points: [invalid-review-reference]\n',
  );

  await expect(resolveMetricsLocation(root)).resolves.toEqual({
    logDir: path.join(root, 'retained-metrics'),
    configPath: path.join(root, '.validator', 'config.yml'),
  });
});
