import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexAdapter, parseCodexTelemetry } from '../../src/cli-adapters/codex.js';
import { resolveCodexLaunchIdentity } from '../../src/cli-adapters/codex-config.js';
import { AdapterExecutionFailure } from '../../src/cli-adapters/shared.js';
import { modelAttemptSchema } from '../../src/metrics/validation.js';
import type { AdapterTelemetry } from '../../src/cli-adapters/shared.js';

const dirs: string[] = [];
const originalCodexHome = process.env.CODEX_HOME;

async function configHome(content?: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-identity-'));
  dirs.push(dir);
  if (content !== undefined) await writeFile(path.join(dir, 'config.toml'), content);
  return dir;
}

afterEach(async () => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const usage = '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":50}}\n';
const threadId = '123e4567-e89b-12d3-a456-426614174000';
const started = `${JSON.stringify({ type: 'thread.started', thread_id: threadId })}\n`;

async function writeRollout(home: string, records: object[]): Promise<void> {
  const day = path.join(home, 'sessions', '2026', '09', '28');
  await mkdir(day, { recursive: true });
  await writeFile(path.join(day, `rollout-2026-09-28T12-00-00-${threadId}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

async function executeObserved({
  config, model, records, stream = started + usage, fail = false,
}: {
  config?: string;
  model?: string;
  records?: object[];
  stream?: string;
  fail?: boolean;
} = {}) {
  const home = await configHome(config);
  process.env.CODEX_HOME = home;
  await writeFile(path.join(home, 'auth.json'), '{}');
  if (records) await writeRollout(home, records);
  const checkpoints: AdapterTelemetry[] = [];
  let launchArgs: string[] = [];
  const adapter = new CodexAdapter(async ({ args, onStdout, cleanup }) => {
    launchArgs = args;
    try {
      onStdout?.(stream);
      if (fail) throw new Error('Codex failed');
      return stream;
    } finally {
      await cleanup();
    }
  });
  try {
    const result = await adapter.execute({ prompt: 'review', diff: '', model, allowToolUse: false,
      onTelemetry: (telemetry) => checkpoints.push(telemetry) });
    return { telemetry: result.telemetry, checkpoints, launchArgs };
  } catch (error) {
    if (!(error instanceof AdapterExecutionFailure)) throw error;
    return { telemetry: error.telemetry, checkpoints, launchArgs };
  }
}

const observedRecords = [
  { type: 'session_meta', payload: { model_provider: 'openai' } },
  { type: 'turn_context', payload: { model: 'gpt-6-sol' } },
];

describe('Codex observed rollout identity', () => {
  test('AC1: records the actual model and provider with only auth.json', async () => {
    const { telemetry, checkpoints } = await executeObserved({ records: observedRecords });
    expect(telemetry.resolved_identity).toEqual({ adapter: 'codex', model: 'gpt-6-sol',
      provider: 'openai', effort: null, provenance: 'telemetry' });
    expect(Object.keys(telemetry.resolved_identity).sort()).toEqual(['adapter', 'effort', 'model', 'provenance', 'provider']);
    expect(telemetry.observed_identities).toMatchObject([{ model: 'gpt-6-sol',
      provider: { availability: 'available', value: 'openai', reason: null }, provenance: 'telemetry' }]);
    expect(telemetry.observed_identity_availability).toEqual({ availability: 'available', reason: null });
    expect(telemetry.diagnostics).toContain('codex_identity_observed_from_rollout');
    expect(telemetry.diagnostics).not.toContain('codex_config_not_found');
    expect(checkpoints[0]?.resolved_identity.model).toBeNull();
    const attempt = {
      record_type: 'model_attempt', attempt_id: 'codex-observed', revision: 1, measurement_schema_version: 1,
      session_id: 'session-1', invocation_id: 'invocation-1',
      lifecycle: { state: 'completed', started_at: null, ended_at: null }, outcome: 'passed',
      ...telemetry, completeness: { ...telemetry.completeness, history: 'complete' },
      provenance: { ...telemetry.provenance, producer_version: '1.14.0',
        build: { availability: 'unavailable', value: null, reason: 'not_injected' } },
    };
    expect(modelAttemptSchema.safeParse(attempt).success).toBe(true);
  });

  test('keeps the launch provider when the rollout reports only a model', async () => {
    const { telemetry } = await executeObserved({ records: [
      { type: 'turn_context', payload: { model: 'gpt-6-sol' } },
    ] });
    expect(telemetry.resolved_identity).toMatchObject({ model: 'gpt-6-sol', provider: 'openai', provenance: 'telemetry' });
  });

  test.each([
    ['pinned', undefined, 'gpt-6-sol'],
    ['configured', 'model = "gpt-6-sol"\n', undefined],
  ])('AC2: keeps matching %s launch resolution', async (_source, config, model) => {
    const { telemetry, launchArgs } = await executeObserved({ config, model, records: observedRecords });
    expect(telemetry.resolved_identity).toMatchObject({ model: 'gpt-6-sol', provider: 'openai', provenance: 'launch_resolution' });
    expect(launchArgs.slice(launchArgs.indexOf('-m'), launchArgs.indexOf('-m') + 2)).toEqual(['-m', 'gpt-6-sol']);
    expect(telemetry.observed_identities).toHaveLength(1);
  });

  test('AC2: keeps the pin requested while resolving a different observed model', async () => {
    const { telemetry } = await executeObserved({ model: 'gpt-5.3-codex', records: observedRecords });
    expect(telemetry.requested_identity.model).toBe('gpt-5.3-codex');
    expect(telemetry.resolved_identity).toMatchObject({ model: 'gpt-6-sol', provenance: 'telemetry' });
    expect(telemetry.diagnostics).toContain('codex_observed_model_mismatch');
  });

  test('uses the observed provider when the model matches but the provider differs', async () => {
    const { telemetry } = await executeObserved({ model: 'gpt-6-sol', records: [
      { type: 'session_meta', payload: { model_provider: 'azure' } },
      { type: 'turn_context', payload: { model: 'gpt-6-sol' } },
    ] });
    expect(telemetry.resolved_identity).toMatchObject({ model: 'gpt-6-sol', provider: 'azure', provenance: 'telemetry' });
    expect(telemetry.diagnostics).toContain('codex_observed_provider_mismatch');
  });

  test('keeps valid identity records before a truncated final rollout line', async () => {
    const home = await configHome();
    process.env.CODEX_HOME = home;
    await writeRollout(home, observedRecords);
    const file = path.join(home, 'sessions', '2026', '09', '28', `rollout-2026-09-28T12-00-00-${threadId}.jsonl`);
    await writeFile(file, `${observedRecords.map((record) => JSON.stringify(record)).join('\n')}\n{"type":"turn_context","payload":`);
    const adapter = new CodexAdapter(async ({ onStdout, cleanup }) => {
      try { onStdout?.(started + usage); return started + usage; }
      finally { await cleanup(); }
    });
    const result = await adapter.execute({ prompt: 'review', diff: '', allowToolUse: false,
      onTelemetry: () => {} });
    expect(result.telemetry.resolved_identity.model).toBe('gpt-6-sol');
  });

  test('keeps identity while skipping an oversized rollout record', async () => {
    const home = await configHome();
    process.env.CODEX_HOME = home;
    await writeRollout(home, observedRecords);
    const file = path.join(home, 'sessions', '2026', '09', '28', `rollout-2026-09-28T12-00-00-${threadId}.jsonl`);
    await writeFile(file, `${observedRecords.map((record) => JSON.stringify(record)).join('\n')}\n${'x'.repeat(8 * 1024 * 1024 + 1)}\n`);
    const adapter = new CodexAdapter(async ({ onStdout, cleanup }) => {
      try { onStdout?.(started + usage); return started + usage; }
      finally { await cleanup(); }
    });
    const result = await adapter.execute({ prompt: 'review', diff: '', allowToolUse: false,
      onTelemetry: () => {} });
    expect(result.telemetry.resolved_identity.model).toBe('gpt-6-sol');
  });

  test('marks a newline-terminated malformed rollout record unreadable', async () => {
    const home = await configHome();
    process.env.CODEX_HOME = home;
    await writeRollout(home, observedRecords);
    const file = path.join(home, 'sessions', '2026', '09', '28', `rollout-2026-09-28T12-00-00-${threadId}.jsonl`);
    await writeFile(file, `${observedRecords.map((record) => JSON.stringify(record)).join('\n')}\nnot-json\n`);
    const adapter = new CodexAdapter(async ({ onStdout, cleanup }) => {
      try { onStdout?.(started + usage); return started + usage; }
      finally { await cleanup(); }
    });
    const result = await adapter.execute({ prompt: 'review', diff: '', allowToolUse: false,
      onTelemetry: () => {} });
    expect(result.telemetry.resolved_identity.model).toBeNull();
    expect(result.telemetry.diagnostics).toContain('codex_rollout_unreadable');
  });

  test.each([
    ['missing rollout', undefined, started + usage, 'codex_rollout_not_found'],
    ['missing model', [{ type: 'session_meta', payload: { model_provider: 'openai' } }], started + usage, 'codex_rollout_model_missing'],
    ['missing thread', observedRecords, usage, 'codex_thread_id_missing'],
  ])('AC3: %s leaves the model unresolved', async (_case, records, stream, reason) => {
    const { telemetry } = await executeObserved({ records, stream });
    expect(telemetry.resolved_identity.model).toBeNull();
    expect(telemetry.diagnostics).toContain(reason);
  });

  test.each([
    ['invalid model', [{ type: 'turn_context', payload: { model: 'bad;model' } }], 'codex_rollout_model_invalid'],
    ['invalid provider', [{ type: 'session_meta', payload: { model_provider: 'account_proxy' } },
      { type: 'turn_context', payload: { model: 'gpt-6-sol' } }], 'codex_rollout_provider_invalid'],
  ])('rejects %s from the rollout', async (_case, records, reason) => {
    const { telemetry } = await executeObserved({ records });
    expect(telemetry.diagnostics).toContain(reason);
    expect(JSON.stringify(telemetry)).not.toContain('bad;model');
    expect(JSON.stringify(telemetry)).not.toContain('account_proxy');
  });

  test('uses the last turn model and falls back to session metadata', async () => {
    const { telemetry } = await executeObserved({ records: [
      { type: 'session_meta', payload: { model: 'session-model', model_provider: 'openai' } },
      { type: 'turn_context', payload: { model: 'first-turn' } },
      { type: 'turn_context', payload: { model: 'gpt-6-sol' } },
    ] });
    expect(telemetry.resolved_identity.model).toBe('gpt-6-sol');
    const fallback = await executeObserved({ records: [
      { type: 'session_meta', payload: { model: 'session-model', model_provider: 'openai' } },
    ] });
    expect(fallback.telemetry.resolved_identity.model).toBe('session-model');
  });

  test('attaches observed identity when streaming fails after thread start', async () => {
    const { telemetry } = await executeObserved({ records: observedRecords, fail: true });
    expect(telemetry.resolved_identity).toMatchObject({ model: 'gpt-6-sol', provider: 'openai', provenance: 'telemetry' });
  });
});

async function execute(config?: string, options: { model?: string; allowToolUse?: boolean } = {}) {
  process.env.CODEX_HOME = await configHome(config);
  const checkpoints: AdapterTelemetry[] = [];
  let launchArgs: string[] = [];
  const adapter = new CodexAdapter(async ({ args, onStdout, cleanup }) => {
    launchArgs = args;
    try {
      onStdout?.(usage);
      return usage;
    } finally {
      await cleanup();
    }
  });
  const result = await adapter.execute({ prompt: 'review', diff: '', ...options, onTelemetry: (telemetry) => checkpoints.push(telemetry) });
  return { result, checkpoints, launchArgs };
}

describe('Codex launch identity', () => {
  test('keeps a pinned model in requested and resolved identity', async () => {
    const { result } = await execute(undefined, { model: 'gpt-6-sol' });
    expect(result.telemetry.requested_identity.model).toBe('gpt-6-sol');
    expect(result.telemetry.resolved_identity).toMatchObject({ model: 'gpt-6-sol', provider: 'openai', provenance: 'launch_resolution' });
  });

  test('resolves the default model from CODEX_HOME for final and checkpoint telemetry', async () => {
    const { result, checkpoints } = await execute('model = "gpt-5.3-codex"\n');
    expect(result.telemetry.requested_identity.model).toBeNull();
    for (const telemetry of [result.telemetry, ...checkpoints]) {
      expect(telemetry.resolved_identity).toMatchObject({ model: 'gpt-5.3-codex', provider: 'openai', provenance: 'launch_resolution' });
    }
    expect(checkpoints).toHaveLength(1);
  });

  test('applies active profile model and provider over top-level values', async () => {
    const { result } = await execute('model = "base"\nmodel_provider = "openai"\nprofile = "fast"\n[profiles."fast"]\nmodel = "gpt-6-sol"\nmodel_provider = "azure"\n');
    expect(result.telemetry.resolved_identity).toMatchObject({ model: 'gpt-6-sol', provider: 'azure' });
  });

  test.each([
    [undefined, 'codex_config_not_found'],
    ['model_provider = "azure"\n', 'codex_config_model_unset'],
  ])('records unresolved identity with %s config', async (config, reason) => {
    const { result } = await execute(config);
    expect(result.telemetry.resolved_identity.model).toBeNull();
    expect(result.telemetry.diagnostics).toContain(reason);
  });

  test('tools-off mode rejects a model tied to an ignored non-OpenAI provider', async () => {
    const { result } = await execute('model = "gpt-5.3-codex"\nmodel_provider = "azure"\n', { allowToolUse: false });
    expect(result.telemetry.resolved_identity).toMatchObject({ model: null, provider: 'openai' });
    expect(result.telemetry.diagnostics).toContain('codex_config_provider_ignored');
  });

  test('tools-off mode forwards the user model to Codex', async () => {
    const { result, launchArgs } = await execute('model = "gpt-5.3-codex"\n', { allowToolUse: false });
    expect(result.telemetry.resolved_identity).toMatchObject({ model: 'gpt-5.3-codex', provider: 'openai' });
    expect(launchArgs.slice(launchArgs.indexOf('-m'), launchArgs.indexOf('-m') + 2)).toEqual(['-m', 'gpt-5.3-codex']);
  });

  test('tools-off mode forwards the active profile model', async () => {
    const { result, launchArgs } = await execute('model = "base"\nprofile = "fast"\n[profiles.fast]\nmodel = "gpt-6-sol"\n', { allowToolUse: false });
    expect(result.telemetry.resolved_identity).toMatchObject({ model: 'gpt-6-sol', provider: 'openai' });
    expect(launchArgs.slice(launchArgs.indexOf('-m'), launchArgs.indexOf('-m') + 2)).toEqual(['-m', 'gpt-6-sol']);
  });

  test('tools-off mode reports a missing user config', async () => {
    const { result } = await execute(undefined, { allowToolUse: false });
    expect(result.telemetry.resolved_identity).toMatchObject({ model: null, provider: 'openai' });
    expect(result.telemetry.diagnostics).toContain('codex_config_not_found');
  });

  test('reads a bare active profile and ignores comments and non-string values', async () => {
    const home = await configHome('profile = "fast" # active\nmodel = 123\n[profiles.fast]\nmodel = \'gpt-6-sol\' # selected\n');
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home } })).toEqual({
      model: 'gpt-6-sol', provider: 'openai', reason: null, launchModel: null,
    });
  });

  test('reports an invalid config model without echoing its value', async () => {
    const home = await configHome('model = "bad;model"\n');
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home } })).toEqual({
      model: null, provider: 'openai', reason: 'codex_config_model_invalid', launchModel: null,
    });
  });

  test('uses Codex config when a configured model is rejected before launch', async () => {
    const { result } = await execute('model = "gpt-5.3-codex"\n', { model: 'bad;model' });
    expect(result.telemetry.requested_identity.model).toBe('bad;model');
    expect(result.telemetry.resolved_identity.model).toBe('gpt-5.3-codex');
    expect(result.telemetry.diagnostics).toContain('codex_config_model_invalid');
  });

  test.each([
    'corp-proxy.internal.host',
    'corp-proxy.internal',
    'account_proxy',
    'bad/provider',
  ])('does not publish a private or unsafe provider id: %s', async (provider) => {
    const home = await configHome(`model = "gpt-5.3-codex"\nmodel_provider = "${provider}"\n`);
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home } })).toEqual({
      model: 'gpt-5.3-codex', provider: null, reason: 'codex_config_provider_invalid', launchModel: null,
    });
  });

  test('omits an unsafe provider from final and checkpoint telemetry', async () => {
    const { result, checkpoints } = await execute('model = "gpt-5.3-codex"\nmodel_provider = "corp-proxy.internal"\n');
    for (const telemetry of [result.telemetry, ...checkpoints]) {
      expect(telemetry.resolved_identity.provider).toBeNull();
      expect(telemetry.diagnostics).toContain('codex_config_provider_invalid');
      expect(JSON.stringify(telemetry)).not.toContain('corp-proxy.internal');
    }
  });

  test('does not claim a user model when a project config may override it', async () => {
    const home = await configHome('model = "gpt-5.3-codex"\n');
    const project = await configHome();
    await mkdir(path.join(project, '.codex'));
    await writeFile(path.join(project, '.codex', 'config.toml'), 'model = "gpt-6-sol"\n');
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home }, cwd: project })).toEqual({
      model: null, provider: 'openai', reason: 'codex_project_config_present', launchModel: null,
    });
  });

  test('project provider does not override the user provider', async () => {
    const home = await configHome('model = "gpt-5.3-codex"\nmodel_provider = "azure"\n');
    const project = await configHome();
    await mkdir(path.join(project, '.codex'));
    await writeFile(path.join(project, '.codex', 'config.toml'), 'model_provider = "other"\n');
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home }, cwd: project })).toEqual({
      model: 'gpt-5.3-codex', provider: 'azure', reason: null, launchModel: null,
    });
  });

  test.each([false, true])('project provider does not change a pinned model provider with tools-off %s', async (ignoreUserConfig) => {
    const home = await configHome();
    const project = await configHome();
    await mkdir(path.join(project, '.codex'));
    await writeFile(path.join(project, '.codex', 'config.toml'), 'model_provider = "azure"\n');
    expect(resolveCodexLaunchIdentity({ configuredModel: 'gpt-6-sol', ignoreUserConfig, env: { CODEX_HOME: home }, cwd: project })).toEqual({
      model: 'gpt-6-sol', provider: 'openai', reason: null, launchModel: 'gpt-6-sol',
    });
  });

  test('tools-off mode keeps the openai provider despite user and project providers', async () => {
    const home = await configHome('model = "gpt-5.3-codex"\nmodel_provider = "other"\n');
    const project = await configHome();
    await mkdir(path.join(project, '.codex'));
    await writeFile(path.join(project, '.codex', 'config.toml'), 'model_provider = "azure"\n');
    expect(resolveCodexLaunchIdentity({ configuredModel: 'gpt-6-sol', ignoreUserConfig: true, env: { CODEX_HOME: home }, cwd: project })).toEqual({
      model: 'gpt-6-sol', provider: 'openai', reason: null, launchModel: 'gpt-6-sol',
    });
  });

  test('ignores provider settings at every project level', async () => {
    const home = await configHome('model = "gpt-6-sol"\nmodel_provider = "other"\n');
    const project = await configHome();
    const nested = path.join(project, 'nested');
    await mkdir(path.join(project, '.git'));
    await mkdir(path.join(project, '.codex'));
    await mkdir(path.join(nested, '.codex'), { recursive: true });
    await writeFile(path.join(project, '.codex', 'config.toml'), 'model_provider = "azure"\n');
    await writeFile(path.join(nested, '.codex', 'config.toml'), 'model_provider = "openai"\n');
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home }, cwd: nested })).toEqual({
      model: 'gpt-6-sol', provider: 'other', reason: null, launchModel: null,
    });
  });

  test('a valid pinned model takes precedence over project config', async () => {
    const home = await configHome('model = "gpt-5.3-codex"\n');
    const project = await configHome();
    await mkdir(path.join(project, '.codex'));
    await writeFile(path.join(project, '.codex', 'config.toml'), 'model = "gpt-6-sol"\n');
    expect(resolveCodexLaunchIdentity({ configuredModel: 'gpt-6-astra', ignoreUserConfig: false, env: { CODEX_HOME: home }, cwd: project })).toEqual({
      model: 'gpt-6-astra', provider: 'openai', reason: null, launchModel: 'gpt-6-astra',
    });
  });

  test('reports an unreadable config', async () => {
    const home = await configHome();
    await mkdir(path.join(home, 'config.toml'));
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home } }).reason).toBe('codex_config_unreadable');
  });
});

test('Codex derives uncached input from total minus cache read with a schema-valid measurement', () => {
  const telemetry = parseCodexTelemetry(usage, {}, {
    model: null, provider: 'openai', reason: 'codex_config_not_found', launchModel: null,
  });
  expect(telemetry.tokens.input_uncached).toEqual({
    availability: 'available', value: 600, reason: null, source: 'validator_derivation',
    origin: 'derived', precision: 'exact', derivation: 'codex_input_total_minus_cache_read', included_in: ['input_total'],
  });
  const attempt = {
    record_type: 'model_attempt', attempt_id: 'codex-1', revision: 1, measurement_schema_version: 1,
    session_id: 'session-1', invocation_id: 'invocation-1',
    lifecycle: { state: 'completed', started_at: null, ended_at: null },
    outcome: 'passed',
    ...telemetry,
    completeness: { ...telemetry.completeness, history: 'complete' },
    provenance: {
      ...telemetry.provenance,
      producer_version: '1.14.0',
      build: { availability: 'unavailable', value: null, reason: 'not_injected' },
    },
  };
  expect(modelAttemptSchema.safeParse(attempt).success).toBe(true);
});

test('Codex rejects cached input larger than total input', () => {
  const telemetry = parseCodexTelemetry('{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":20}}\n');
  expect(telemetry.tokens.input_uncached).toMatchObject({ availability: 'unavailable', reason: 'invalid_provider_measurement' });
});

test.each([
  ['input_tokens', -10, 'input_total'],
  ['cached_input_tokens', -20, 'cache_read'],
  ['output_tokens', -5, 'output'],
])('Codex rejects invalid %s counter', (field, value, tokenField) => {
  const event = { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 5, [field]: value } };
  const telemetry = parseCodexTelemetry(`${JSON.stringify(event)}\n`);
  expect(telemetry.tokens[tokenField as keyof typeof telemetry.tokens]).toMatchObject({
    availability: 'unavailable', reason: 'invalid_provider_measurement',
  });
  if (field !== 'output_tokens') {
    expect(telemetry.tokens.input_uncached).toMatchObject({
      availability: 'unavailable', reason: 'invalid_provider_measurement',
    });
  }
});
