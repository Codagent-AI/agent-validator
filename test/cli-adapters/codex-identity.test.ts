import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexAdapter, parseCodexTelemetry } from '../../src/cli-adapters/codex.js';
import { resolveCodexLaunchIdentity } from '../../src/cli-adapters/codex-config.js';
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

async function execute(config?: string, options: { model?: string; allowToolUse?: boolean } = {}) {
  process.env.CODEX_HOME = await configHome(config);
  const checkpoints: AdapterTelemetry[] = [];
  const adapter = new CodexAdapter(async ({ onStdout, cleanup }) => {
    try {
      onStdout?.(usage);
      return usage;
    } finally {
      await cleanup();
    }
  });
  const result = await adapter.execute({ prompt: 'review', diff: '', ...options, onTelemetry: (telemetry) => checkpoints.push(telemetry) });
  return { result, checkpoints };
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

  test('tools-off mode ignores user config and reports the unknown built-in model', async () => {
    const { result } = await execute('model = "gpt-5.3-codex"\nmodel_provider = "azure"\n', { allowToolUse: false });
    expect(result.telemetry.resolved_identity).toMatchObject({ model: null, provider: 'openai' });
    expect(result.telemetry.diagnostics).toContain('codex_default_model_unresolved_config_ignored');
  });

  test('reads a bare active profile and ignores comments and non-string values', async () => {
    const home = await configHome('profile = "fast" # active\nmodel = 123\n[profiles.fast]\nmodel = \'gpt-6-sol\' # selected\n');
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home } })).toEqual({
      model: 'gpt-6-sol', provider: 'openai', reason: null,
    });
  });

  test('reports an invalid config model without echoing its value', async () => {
    const home = await configHome('model = "bad;model"\n');
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home } })).toEqual({
      model: null, provider: 'openai', reason: 'codex_config_model_invalid',
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
      model: 'gpt-5.3-codex', provider: null, reason: 'codex_config_provider_invalid',
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
      model: null, provider: 'openai', reason: 'codex_project_config_present',
    });
  });

  test('project provider alone does not override the user provider', async () => {
    const home = await configHome('model = "gpt-5.3-codex"\nmodel_provider = "azure"\n');
    const project = await configHome();
    await mkdir(path.join(project, '.codex'));
    await writeFile(path.join(project, '.codex', 'config.toml'), 'model_provider = "other"\n');
    expect(resolveCodexLaunchIdentity({ ignoreUserConfig: false, env: { CODEX_HOME: home }, cwd: project })).toEqual({
      model: 'gpt-5.3-codex', provider: 'azure', reason: null,
    });
  });

  test('a valid pinned model takes precedence over project config', async () => {
    const home = await configHome('model = "gpt-5.3-codex"\n');
    const project = await configHome();
    await mkdir(path.join(project, '.codex'));
    await writeFile(path.join(project, '.codex', 'config.toml'), 'model = "gpt-6-sol"\n');
    expect(resolveCodexLaunchIdentity({ configuredModel: 'gpt-6-astra', ignoreUserConfig: false, env: { CODEX_HOME: home }, cwd: project })).toEqual({
      model: 'gpt-6-astra', provider: 'openai', reason: null,
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
    model: null, provider: 'openai', reason: 'codex_default_model_unresolved_config_ignored',
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
