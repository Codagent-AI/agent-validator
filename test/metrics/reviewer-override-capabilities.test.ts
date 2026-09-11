import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fromJSONSchema } from 'zod';
import {
  REVIEWER_CLI_ENV,
  REVIEWER_EFFORT_ENV,
  REVIEWER_MODEL_ENV,
} from '../../src/config/reviewer-override.js';
import { validateCapabilities } from '../../src/metrics/validation.js';

const root = path.resolve(import.meta.dir, '../..');
const schemaPath = path.join(
  root,
  'contracts/validator-metrics/v1/capabilities.schema.json',
);

const validDocument = {
  capabilities_version: 1 as const,
  protocol_versions: [1] as const,
  measurement_schema_versions: [1] as const,
  reviewer_override: { supported: true as const },
  limits: {
    default_inventory_count: 10,
    maximum_inventory_count: 20,
    default_export_count: 5,
    maximum_export_count: 10,
    default_export_bytes: 1000,
    maximum_export_bytes: 2000,
    maximum_individual_record_bytes: 1500,
  },
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function invokeMetrics(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(root, 'src/index.ts'), 'metrics', ...args],
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function invokeCapabilities(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return invokeMetrics(cwd, ['capabilities'], env);
}

function withoutReviewerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env[REVIEWER_CLI_ENV];
  delete env[REVIEWER_MODEL_ENV];
  delete env[REVIEWER_EFFORT_ENV];
  return env;
}

/**
 * Data operations must ignore reviewer override environment entirely and must
 * not grow a `reviewer_override` field. The environment used here is malformed
 * on purpose: an overlay command would fail closed on it.
 */
const DATA_OPERATIONS: { name: string; args: string[] }[] = [
  {
    name: 'pending',
    args: ['pending', '--protocol-version', '1', '--consumer', 'runner'],
  },
  {
    name: 'export',
    args: [
      'export',
      '--protocol-version',
      '1',
      '--consumer',
      'runner',
      '--context',
      'ctx-1',
    ],
  },
  {
    name: 'acknowledge',
    args: [
      'acknowledge',
      '--protocol-version',
      '1',
      '--consumer',
      'runner',
      '--context',
      'ctx-1',
      '--receipt',
      'token',
    ],
  },
  {
    name: 'discard',
    args: [
      'discard',
      '--protocol-version',
      '1',
      '--consumer',
      'runner',
      '--context',
      'ctx-1',
      '--receipt',
      'token',
      '--confirm',
    ],
  },
];

describe('INT-004: Capabilities document advertises support', () => {
  test('schema file and Zod validator accept a document containing reviewer_override', async () => {
    const schemaJson = JSON.parse(await readFile(schemaPath, 'utf8'));
    expect(schemaJson.required).toContain('reviewer_override');
    expect(schemaJson.properties.reviewer_override).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['supported'],
      properties: { supported: { const: true } },
    });

    const published = fromJSONSchema(schemaJson);
    expect(published.safeParse(validDocument).success).toBe(true);
    expect(validateCapabilities(validDocument).success).toBe(true);
  });

  test('metrics capabilities advertises support with no project and ignores reviewer env', async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), 'validator-capabilities-override-'),
    );
    temporaryDirectories.push(cwd);

    const withoutEnv = withoutReviewerEnv();

    const withEnv = {
      ...withoutEnv,
      [REVIEWER_MODEL_ENV]: 'opus',
      [REVIEWER_EFFORT_ENV]: 'not-a-real-effort',
    };

    const first = await invokeCapabilities(cwd, withoutEnv);
    const second = await invokeCapabilities(cwd, withEnv);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const firstJson = JSON.parse(first.stdout) as {
      capabilities_version: number;
      reviewer_override: { supported: boolean };
    };
    const secondJson = JSON.parse(second.stdout) as {
      capabilities_version: number;
      reviewer_override: { supported: boolean };
    };
    expect(firstJson.capabilities_version).toBe(1);
    expect(firstJson.reviewer_override).toEqual({ supported: true });
    expect(secondJson).toEqual(firstJson);

    const entries = await readdir(cwd);
    expect(entries).toEqual([]);
  });
});

describe('INT-004: Metrics data operations are unchanged', () => {
  test.each(DATA_OPERATIONS)(
    'metrics $name ignores reviewer env and omits reviewer_override',
    async ({ args }) => {
      const cwd = await mkdtemp(
        path.join(os.tmpdir(), 'validator-metrics-override-'),
      );
      temporaryDirectories.push(cwd);

      const withoutEnv = withoutReviewerEnv();
      const withEnv = {
        ...withoutEnv,
        [REVIEWER_MODEL_ENV]: 'opus',
        [REVIEWER_EFFORT_ENV]: 'not-a-real-effort',
      };

      const baseline = await invokeMetrics(cwd, args, withoutEnv);
      const withOverride = await invokeMetrics(cwd, args, withEnv);

      expect(withOverride.exitCode).toBe(baseline.exitCode);
      expect(withOverride.stdout).toBe(baseline.stdout);

      const parsed = JSON.parse(withOverride.stdout) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('reviewer_override');
      expect(parsed.protocol_version).toBe(1);

      const entries = await readdir(cwd);
      expect(entries).toEqual([]);
    },
  );
});
