import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonResult } from '../../src/gates/review-agg.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('review metrics references', () => {
  test('writes the dispatch attempt ID into a review JSON artifact', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'review-metrics-'));
    temporaryDirectories.push(directory);
    const logPath = path.join(directory, 'review_source_fixture@1.1.log');

    const jsonPath = await writeJsonResult(
      logPath,
      'fixture',
      'pass',
      '{"status":"pass"}',
      { status: 'pass' },
      undefined,
      'attempt-1',
    );

    expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toMatchObject({
      attempt_id: 'attempt-1',
      status: 'pass',
    });
  });
});
