import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export interface MetricsLocation {
  logDir: string;
  configPath: string | null;
}

/**
 * Resolves only the telemetry location. It intentionally does not invoke the
 * normal config loader, because that would load gates and review definitions.
 */
export async function resolveMetricsLocation(
  project = process.cwd(),
  explicitConfig?: string,
): Promise<MetricsLocation> {
  const root = path.resolve(project);
  const configPath = explicitConfig
    ? path.resolve(root, explicitConfig)
    : selectConfig(root);
  if (!configPath)
    return { logDir: path.join(root, 'validator_logs'), configPath: null };
  let parsed: unknown;
  try {
    parsed = YAML.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Metrics configuration is unavailable: ${safeMessage(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Metrics configuration is malformed: expected an object');
  const logDir = (parsed as Record<string, unknown>).log_dir;
  if (logDir !== undefined && (typeof logDir !== 'string' || !logDir.trim()))
    throw new Error(
      'Metrics configuration is malformed: log_dir must be a non-empty string',
    );
  return {
    logDir: path.resolve(
      root,
      typeof logDir === 'string' ? logDir : 'validator_logs',
    ),
    configPath,
  };
}

function selectConfig(root: string): string | null {
  const validator = path.join(root, '.validator', 'config.yml');
  if (existsSync(validator)) return validator;
  const legacy = path.join(root, '.gauntlet', 'config.yml');
  return existsSync(legacy) ? legacy : null;
}

function safeMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'could not read configuration';
}
