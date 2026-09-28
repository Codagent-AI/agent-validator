import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAFE_MODEL_ID_PATTERN } from './model-resolution.js';

export interface CodexLaunchIdentity {
  model: string | null;
  provider: string | null;
  reason: string | null;
}

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

function ignoredConfigIdentity(configuredModel?: string): CodexLaunchIdentity {
  if (!configuredModel) {
    return {
      model: null,
      provider: 'openai',
      reason: 'codex_default_model_unresolved_user_config_ignored',
    };
  }
  if (!SAFE_MODEL_ID_PATTERN.test(configuredModel)) {
    return {
      model: null,
      provider: 'openai',
      reason: 'codex_config_model_invalid',
    };
  }
  return { model: configuredModel, provider: 'openai', reason: null };
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
  if (ignoreUserConfig) return ignoredConfigIdentity(configuredModel);

  const configPath = path.resolve(
    cwd,
    env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'config.toml',
  );
  const { config, reason: configReason } = readConfig(configPath);
  const provider = config.model_provider || 'openai';
  if (configuredModel) {
    return SAFE_MODEL_ID_PATTERN.test(configuredModel)
      ? { model: configuredModel, provider, reason: null }
      : { model: null, provider, reason: 'codex_config_model_invalid' };
  }
  if (configReason) return { model: null, provider, reason: configReason };
  if (!config.model)
    return { model: null, provider, reason: 'codex_config_model_unset' };
  if (!SAFE_MODEL_ID_PATTERN.test(config.model)) {
    return { model: null, provider, reason: 'codex_config_model_invalid' };
  }
  return { model: config.model, provider, reason: null };
}
