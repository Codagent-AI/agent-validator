import { afterEach, expect, test } from 'bun:test';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('built Node clean honors zero retention without touching existing archives', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const node = Bun.which('node');
  expect(node).toBeTruthy();
  await access(path.join(root, 'dist', 'index.js'));
  const project = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-clean-e2e-'));
  directories.push(project);
  const logDir = path.join(project, 'logs');
  await mkdir(path.join(project, '.validator'), { recursive: true });
  await mkdir(path.join(logDir, 'previous'), { recursive: true });
  await writeFile(
    path.join(project, '.validator', 'config.yml'),
    'log_dir: logs\nmax_previous_logs: 0\ncli: {}\nentry_points:\n  - path: .\n',
  );
  await writeFile(path.join(logDir, 'current.1.log'), 'current');
  await writeFile(path.join(logDir, 'previous', 'retained.log'), 'retained');

  const child = Bun.spawn({
    cmd: [node!, path.join(root, 'dist', 'index.js'), 'clean'],
    cwd: project,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  await expect(readFile(path.join(logDir, 'current.1.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(path.join(logDir, 'previous', 'retained.log'), 'utf8')).toBe('retained');
});

test('built Node clean uses validator_logs when no configuration exists', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const node = Bun.which('node');
  expect(node).toBeTruthy();
  const project = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-clean-default-e2e-'));
  directories.push(project);
  await mkdir(path.join(project, 'validator_logs'), { recursive: true });
  await writeFile(path.join(project, 'validator_logs', 'current.1.log'), 'current');

  const child = Bun.spawn({
    cmd: [node!, path.join(root, 'dist', 'index.js'), 'clean'],
    cwd: project,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect(exitCode, stderr).toBe(0);
  expect(
    await readFile(
      path.join(project, 'validator_logs', 'previous', 'current.1.log'),
      'utf8',
    ),
  ).toBe('current');
});

test('built Node clean fails rather than treating a log-directory file as cleanable', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const node = Bun.which('node');
  expect(node).toBeTruthy();
  const project = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-clean-invalid-e2e-'));
  directories.push(project);
  await mkdir(path.join(project, '.validator'), { recursive: true });
  await writeFile(
    path.join(project, '.validator', 'config.yml'),
    'log_dir: logs\ncli: {}\nentry_points:\n  - path: .\n',
  );
  await writeFile(path.join(project, 'logs'), 'not a directory');

  const child = Bun.spawn({
    cmd: [node!, path.join(root, 'dist', 'index.js'), 'clean'],
    cwd: project,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain('not a directory');
});
