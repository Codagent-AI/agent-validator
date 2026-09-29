import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { cliConfigSchema } from './schema.js';

let testConfigPath: string | undefined;

export function setGlobalConfigPathForTests(
  configPath: string | undefined,
): void {
  testConfigPath = configPath;
}

export function getGlobalConfigPath(): string {
  return (
    testConfigPath ??
    path.join(os.homedir(), '.config', 'agent-validator', 'config.yml')
  );
}

export const debugLogConfigSchema = z.object({
  enabled: z.boolean().default(false),
  max_size_mb: z.number().default(10),
});

export type DebugLogConfig = z.infer<typeof debugLogConfigSchema>;

const globalConfigSchema = z.object({
  debug_log: debugLogConfigSchema.default({ enabled: false, max_size_mb: 10 }),
  cli: cliConfigSchema.optional(),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  debug_log: { enabled: false, max_size_mb: 10 },
};

export type GlobalConfigReadResult =
  | { status: 'missing'; path: string }
  | { status: 'ok'; path: string; config: GlobalConfig }
  | {
      status: 'invalid';
      path: string;
      reason: string;
      issues: { message: string; field?: string }[];
    };

export class GlobalConfigError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`Invalid global config at ${path}: ${reason}`);
    this.name = 'GlobalConfigError';
  }
}

export async function readGlobalConfig(
  configPath = getGlobalConfigPath(),
): Promise<GlobalConfigReadResult> {
  const absolutePath = path.resolve(configPath);
  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    const parsed = globalConfigSchema.safeParse(YAML.parse(content) ?? {});
    if (parsed.success)
      return { status: 'ok', path: absolutePath, config: parsed.data };
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return {
      status: 'invalid',
      path: absolutePath,
      issues,
      reason: issues
        .map(({ field, message }) => (field ? `${field}: ${message}` : message))
        .join('; '),
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return { status: 'missing', path: absolutePath };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: 'invalid',
      path: absolutePath,
      reason,
      issues: [{ message: reason }],
    };
  }
}

export async function loadGlobalConfig(
  configPath = getGlobalConfigPath(),
): Promise<GlobalConfig> {
  const result = await readGlobalConfig(configPath);
  if (result.status === 'missing') return DEFAULT_GLOBAL_CONFIG;
  if (result.status === 'invalid')
    throw new GlobalConfigError(result.path, result.reason);
  return result.config;
}
