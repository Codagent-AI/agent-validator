// biome-ignore lint/nursery/noExcessiveClassesPerFile: both CLI configuration errors belong to this resolution API
import { getValidCLITools } from '../cli-adapters/tool-names.js';
import type { CLIConfig } from './types.js';

export type CliSourceKind = 'project' | 'global';
export interface CliSource {
  kind: CliSourceKind;
  path: string;
}
export interface ResolvedCli {
  cli: CLIConfig;
  source: CliSource;
}
export interface CliIssue {
  field: string;
  message: string;
}

export function resolveEffectiveCli(args: {
  projectCli: CLIConfig | undefined;
  projectConfigPath: string;
  globalCli: CLIConfig | undefined;
  globalConfigPath: string;
}): ResolvedCli | undefined {
  const { projectCli, projectConfigPath, globalCli, globalConfigPath } = args;
  const cli = projectCli !== undefined ? projectCli : globalCli;
  if (cli === undefined) return undefined;
  return {
    cli: { ...cli, ...(cli.adapters ? { adapters: { ...cli.adapters } } : {}) },
    source:
      projectCli !== undefined
        ? { kind: 'project', path: projectConfigPath }
        : { kind: 'global', path: globalConfigPath },
  };
}

export function missingCliConfigMessage(
  projectPath: string,
  globalPath: string,
): string {
  return `No "cli" block found. Add a cli block to ${projectPath} (project) or ${globalPath} (global).`;
}

export class MissingCliConfigError extends Error {
  constructor(projectPath: string, globalPath: string) {
    super(missingCliConfigMessage(projectPath, globalPath));
    this.name = 'MissingCliConfigError';
  }
}

export function describeCliSource(source: CliSource): string {
  return `${source.path} (${source.kind} config)`;
}

export function inferDefaultPreference(cli: CLIConfig): CLIConfig {
  if (cli.default_preference) return cli;
  const keys = cli.adapters ? Object.keys(cli.adapters) : [];
  return keys.length > 0 ? { ...cli, default_preference: keys } : cli;
}

export function validateCliSemantics(cli: CLIConfig): CliIssue[] {
  const defaults = cli.default_preference;
  if (!defaults || defaults.length === 0)
    return [
      {
        field: 'cli.default_preference',
        message:
          'cli.default_preference is required when multiple adapters are configured (or set cli.adapters with at least one entry)',
      },
    ];
  const validTools = getValidCLITools();
  return defaults.flatMap((tool, index) =>
    validTools.includes(tool)
      ? []
      : [
          {
            field: `cli.default_preference[${index}]`,
            message: `Invalid CLI tool "${tool}" in default_preference. Valid options are: ${validTools.join(', ')}`,
          },
        ],
  );
}

export class InvalidCliConfigError extends Error {
  constructor(
    readonly path: string,
    readonly issues: CliIssue[],
    source: CliSource,
  ) {
    super(
      `Invalid cli config in ${describeCliSource(source)}: ${issues.map(({ field, message }) => `${field}: ${message}`).join('; ')}`,
    );
    this.name = 'InvalidCliConfigError';
  }
}
