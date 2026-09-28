import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAFE_MODEL_ID_PATTERN } from './model-resolution.js';

export interface CodexLaunchIdentity {
  model: string | null;
  provider: string | null;
  reason: string | null;
  launchModel: string | null;
}

// Provider IDs enter metrics identity, so reject values resembling private evidence.
const PRIVATE_PROVIDER_ID =
  /(?:prompt|response|credential|password|api[_ -]?key|account|user|organization|email|host|machine)/i;
const SAFE_PROVIDER_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const TABLE_HEADER = /^\s*\[\s*([^\]\n]+)\s*\]\s*(?:#.*)?$/;
const STRING_ASSIGNMENT =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*(?:#.*)?$/;

function tableName(line: string): string | null {
  const raw = TABLE_HEADER.exec(line)?.[1]?.trim();
  if (!raw) return null;
  const profile =
    /^profiles\.(?:([A-Za-z0-9_-]+)|"([^"\n]+)"|'([^'\n]+)')$/.exec(raw);
  if (profile) return `profiles.${profile[1] ?? profile[2] ?? profile[3]}`;
  return /^[A-Za-z0-9_.-]+$/.test(raw) ? raw : null;
}

function stringAssignment(line: string): [string, string] | null {
  const match = STRING_ASSIGNMENT.exec(line);
  return match?.[1] === undefined
    ? null
    : [match[1], match[2] ?? match[3] ?? ''];
}

/** Read only the string keys that affect an unprofiled Codex launch. */
function parseConfig(content: string): {
  model?: string;
  model_provider?: string;
} {
  const tables = new Map<string, Record<string, string>>([['', {}]]);
  let table = '';
  for (const line of content.split(/\r?\n/)) {
    const header = tableName(line);
    if (header !== null) {
      table = header;
      if (!tables.has(table)) tables.set(table, {});
      continue;
    }
    const assignment = stringAssignment(line);
    const values = tables.get(table);
    if (assignment && values) values[assignment[0]] = assignment[1];
  }
  const top = tables.get('') ?? {};
  const active = top.profile
    ? tables.get(`profiles.${top.profile}`)
    : undefined;
  return {
    model: active?.model ?? top.model,
    model_provider: active?.model_provider ?? top.model_provider,
  };
}

function readConfig(configPath: string): {
  config: ReturnType<typeof parseConfig>;
  reason: string | null;
} {
  try {
    return {
      config: parseConfig(readFileSync(configPath, 'utf8')),
      reason: null,
    };
  } catch (error) {
    return {
      config: {},
      reason:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'codex_config_not_found'
          : 'codex_config_unreadable',
    };
  }
}

/** Codex loads project config only when trusted; trust is unknown here. */
function projectConfigMayOverride(cwd: string): {
  model: boolean;
  providers: Array<string | null>;
} {
  let directory = path.resolve(cwd);
  let model = false;
  const providers: Array<string | null> = [];
  while (true) {
    const { config, reason } = readConfig(
      path.join(directory, '.codex', 'config.toml'),
    );
    model ||=
      config.model !== undefined || reason === 'codex_config_unreadable';
    if (config.model_provider !== undefined)
      providers.push(config.model_provider);
    if (reason === 'codex_config_unreadable') providers.push(null);
    if (existsSync(path.join(directory, '.git'))) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return { model, providers };
}

function resolveProvider(configuredProvider?: string): {
  provider: string | null;
  reason: string | null;
} {
  if (configuredProvider === undefined)
    return { provider: 'openai', reason: null };
  if (
    !SAFE_PROVIDER_ID_PATTERN.test(configuredProvider) ||
    PRIVATE_PROVIDER_ID.test(configuredProvider)
  )
    return { provider: null, reason: 'codex_config_provider_invalid' };
  return { provider: configuredProvider, reason: null };
}

function resolveModel(
  configuredModel: string | undefined,
  config: ReturnType<typeof parseConfig>,
  configReason: string | null,
  ignoreUserConfig: boolean,
): { model: string | null; reason: string | null; pinned: boolean } {
  if (configuredModel && SAFE_MODEL_ID_PATTERN.test(configuredModel))
    return { model: configuredModel, reason: null, pinned: true };
  const pinReason = configuredModel ? 'codex_config_model_invalid' : null;
  if (configReason)
    return { model: null, reason: pinReason ?? configReason, pinned: false };
  if (
    ignoreUserConfig &&
    config.model_provider &&
    config.model_provider !== 'openai'
  )
    return {
      model: null,
      reason: pinReason ?? 'codex_config_provider_ignored',
      pinned: false,
    };
  if (!config.model)
    return {
      model: null,
      reason: pinReason ?? 'codex_config_model_unset',
      pinned: false,
    };
  if (SAFE_MODEL_ID_PATTERN.test(config.model))
    return { model: config.model, reason: pinReason, pinned: false };
  return {
    model: null,
    reason: pinReason ?? 'codex_config_model_invalid',
    pinned: false,
  };
}

export function resolveCodexLaunchIdentity({
  configuredModel,
  ignoreUserConfig,
  env = process.env,
  cwd = process.cwd(),
}: {
  configuredModel?: string;
  ignoreUserConfig: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): CodexLaunchIdentity {
  const configPath = path.resolve(
    cwd,
    env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'config.toml',
  );
  const { config, reason: configReason } = readConfig(configPath);
  const { provider, reason: providerReason } = ignoreUserConfig
    ? { provider: 'openai', reason: null }
    : resolveProvider(config.model_provider);
  const project = projectConfigMayOverride(cwd);
  const resolved = resolveModel(
    configuredModel,
    config,
    configReason,
    ignoreUserConfig,
  );
  let { model } = resolved;
  let reason = resolved.reason ?? providerReason;

  const launchModel =
    resolved.pinned || (ignoreUserConfig && model) ? model : null;
  if (project.model && !launchModel) {
    model = null;
    reason ??= 'codex_project_config_present';
  }
  const projectProviderDiffers = project.providers.some(
    (configuredProvider) => configuredProvider !== provider,
  );
  if (projectProviderDiffers) {
    return {
      model,
      provider: null,
      reason: 'codex_project_config_provider_present',
      launchModel,
    };
  }
  return {
    model,
    provider,
    reason,
    launchModel,
  };
}
