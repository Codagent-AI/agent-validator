// biome-ignore lint/nursery/noExcessiveClassesPerFile: both CLI configuration errors belong to this resolution API
import { getValidCLITools } from '../cli-adapters/tool-names.js';
import { type ConfigIssue, formatConfigIssues } from './global.js';
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
export interface CliIssue extends ConfigIssue {
  field: string;
}

export function resolveEffectiveCli(args: {
  projectCli: CLIConfig | undefined;
  projectConfigPath: string;
  globalCli: CLIConfig | undefined;
  globalConfigPath: string;
}): ResolvedCli | undefined {
  const { projectCli, projectConfigPath, globalCli, globalConfigPath } = args;
  if (projectCli !== undefined)
    return copyResolved(projectCli, {
      kind: 'project',
      path: projectConfigPath,
    });
  if (globalCli !== undefined)
    return copyResolved(globalCli, { kind: 'global', path: globalConfigPath });
  return undefined;
}

/** Copies the chosen block so in-memory overlays never mutate the parsed config. */
function copyResolved(cli: CLIConfig, source: CliSource): ResolvedCli {
  const adapters = cli.adapters ? { adapters: { ...cli.adapters } } : {};
  return { cli: { ...cli, ...adapters }, source };
}

export type EffectiveCliCheck =
  | { status: 'missing' }
  | {
      status: 'resolved';
      cli: CLIConfig;
      source: CliSource;
      issues: CliIssue[];
    };

/**
 * Resolves the effective CLI block, infers default_preference, and collects
 * semantic issues. Shared by runtime loading and structured validation so
 * both apply identical rules.
 */
export function checkEffectiveCli(
  args: Parameters<typeof resolveEffectiveCli>[0],
): EffectiveCliCheck {
  const resolved = resolveEffectiveCli(args);
  if (!resolved) return { status: 'missing' };
  const cli = inferDefaultPreference(resolved.cli);
  return {
    status: 'resolved',
    cli,
    source: resolved.source,
    issues: validateCliSemantics(cli),
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
  readonly path: string;

  constructor(
    readonly source: CliSource,
    readonly issues: CliIssue[],
  ) {
    super(
      `Invalid cli config in ${describeCliSource(source)}: ${formatConfigIssues(issues)}`,
    );
    this.name = 'InvalidCliConfigError';
    this.path = source.path;
  }
}
