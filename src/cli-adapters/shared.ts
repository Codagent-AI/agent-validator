import { type ChildProcess, spawn } from 'node:child_process';
import type { FileHandle } from 'node:fs/promises';
import fs from 'node:fs/promises';
import type {
  IdentityValue,
  MeasurementValue,
  ModelAttempt,
  ObservedIdentity,
  ReportedCost,
  TokenMeasurements,
  UnallocatedUsage,
  UsageAllocation,
} from '../metrics/types.js';

/**
 * Safe evidence emitted by an adapter. The review runtime owns attempt lifecycle,
 * invocation context, and persistence; adapters only report what their source
 * established.
 */
export interface AdapterTelemetry {
  adapter: string;
  requested_identity: IdentityValue;
  resolved_identity: IdentityValue;
  observed_identities: ObservedIdentity[];
  observed_identity_availability: {
    availability: 'available' | 'unavailable';
    reason: string | null;
  };
  tokens: TokenMeasurements;
  provider_native_usage: ModelAttempt['provider_native_usage'];
  completeness: Pick<
    ModelAttempt['completeness'],
    | 'collection'
    | 'canonical_fields'
    | 'normalized_total'
    | 'per_model_attribution'
  >;
  allocations: UsageAllocation[];
  unallocated_usage: UnallocatedUsage | null;
  provider_reported_costs: ReportedCost[];
  provenance: Pick<
    ModelAttempt['provenance'],
    'adapter_mapping_version' | 'cli_version' | 'source_format_version'
  >;
  diagnostics: string[];
}

export interface AdapterExecutionResult {
  text: string;
  telemetry: AdapterTelemetry;
}

export class AdapterExecutionFailure extends Error {
  override readonly cause: Error;

  constructor(
    operationalError: Error,
    readonly telemetry: AdapterTelemetry,
  ) {
    super(operationalError.message, { cause: operationalError });
    this.name = 'AdapterExecutionFailure';
    this.cause = operationalError;
  }
}

export function unavailableMeasurement<T>(reason: string): MeasurementValue<T> {
  return {
    availability: 'unavailable',
    value: null,
    reason,
    source: null,
    origin: null,
    precision: null,
    derivation: null,
    included_in: null,
  };
}

export function observedMeasurement(
  value: number,
  source: Extract<
    MeasurementValue<number>,
    { availability: 'available' }
  >['source'],
  precision: Extract<
    MeasurementValue<number>,
    { availability: 'available' }
  >['precision'] = 'exact',
  includedIn: string[] | null = null,
): MeasurementValue<number> {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
    return unavailableMeasurement('invalid_provider_measurement');
  }
  return {
    availability: 'available',
    value,
    reason: null,
    source,
    origin: 'observed',
    precision,
    derivation: null,
    included_in: includedIn,
  };
}

function unavailableTokens(reason: string): TokenMeasurements {
  return {
    input_total: unavailableMeasurement(reason),
    input_uncached: unavailableMeasurement(reason),
    cache_read: unavailableMeasurement(reason),
    cache_write: unavailableMeasurement(reason),
    output: unavailableMeasurement(reason),
    reasoning: unavailableMeasurement(reason),
    provider_total: unavailableMeasurement(reason),
    normalized_total: unavailableMeasurement(reason),
  };
}

/** Creates the conservative baseline used before a provider establishes evidence. */
export function createUnavailableTelemetry(
  adapter: string,
  opts: {
    requestedModel?: string;
    resolvedModel?: string;
    requestedEffort?: string;
    reason?: string;
  } = {},
): AdapterTelemetry {
  const reason = opts.reason ?? 'adapter_usage_unsupported';
  return {
    adapter,
    requested_identity: {
      adapter,
      model: opts.requestedModel ?? null,
      provider: null,
      effort: opts.requestedEffort ?? null,
      provenance: 'configuration',
    },
    resolved_identity: {
      adapter,
      model: opts.resolvedModel ?? opts.requestedModel ?? null,
      provider: null,
      effort: opts.requestedEffort ?? null,
      provenance: 'launch_resolution',
    },
    observed_identities: [],
    observed_identity_availability: { availability: 'unavailable', reason },
    tokens: unavailableTokens(reason),
    provider_native_usage: [],
    completeness: {
      collection: 'unavailable',
      canonical_fields: 'unavailable',
      normalized_total: 'unavailable',
      per_model_attribution: 'unavailable',
    },
    allocations: [],
    unallocated_usage: null,
    provider_reported_costs: [],
    provenance: {
      adapter_mapping_version: 'adapter-collection-v1',
      cli_version: {
        availability: 'unavailable',
        value: null,
        reason: 'not_collected',
      },
      source_format_version: {
        availability: 'unavailable',
        value: null,
        reason: 'not_exposed',
      },
    },
    diagnostics: [reason],
  };
}

export interface CLIAdapterHealth {
  available: boolean;
  status: 'healthy' | 'missing' | 'unhealthy';
  message?: string;
}

/**
 * Collects stderr from a child process and returns a getter for the accumulated output.
 * Also forwards each chunk to the optional onOutput callback.
 */
export function collectStderr(
  child: ChildProcess,
  onOutput?: (text: string) => void,
): () => string {
  const chunks: string[] = [];
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    chunks.push(text);
    onOutput?.(text);
  });
  return () => chunks.join('');
}

/**
 * Builds an Error for a non-zero process exit, including stdout and stderr if available.
 * Both stdout and stderr are included to ensure usage limit messages are captured
 * regardless of which stream the CLI writes them to.
 */
export function processExitError(
  code: number | null,
  getStderr: () => string,
  getStdout?: () => string,
): Error {
  const stderr = getStderr();
  const stdout = getStdout?.() ?? '';
  const output = [stdout, stderr].filter(Boolean).join('\n');
  return new Error(
    `Process exited with code ${code}${output ? `\n${output}` : ''}`,
  );
}

export async function runStreamingCommand(opts: {
  command: string;
  args: string[];
  tmpFile: string;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
  cleanup: () => Promise<void>;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const inputStream = fs.open(opts.tmpFile, 'r').then((handle) => {
      const stream = handle.createReadStream();
      return { stream, handle };
    });

    inputStream
      .then(({ stream, handle }) => {
        const child = spawn(opts.command, opts.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: opts.env,
        });

        stream.pipe(child.stdin);

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (opts.timeoutMs) {
          timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Command timed out'));
          }, opts.timeoutMs);
        }

        child.stdout.on('data', (data: Buffer) => {
          const chunk = data.toString();
          chunks.push(chunk);
          opts.onOutput?.(chunk);
        });

        const getStderr = collectStderr(child, opts.onOutput);

        child.on('close', (code, signal) => {
          void finalizeProcessClose({
            code,
            signal,
            timeoutId,
            handle,
            cleanup: opts.cleanup,
            chunks,
            getStderr,
            resolve,
            reject,
          });
        });

        child.on('error', async (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          try {
            await handle.close();
          } catch {
            /* ignore */
          }
          try {
            await opts.cleanup();
          } catch {
            /* ignore */
          }
          reject(err);
        });
      })
      .catch(async (err) => {
        try {
          await opts.cleanup();
        } catch {
          /* ignore */
        }
        reject(err);
      });
  });
}

export async function finalizeProcessClose(opts: {
  code: number | null;
  signal?: NodeJS.Signals | string | null;
  timeoutId?: ReturnType<typeof setTimeout>;
  handle: FileHandle;
  cleanup: () => Promise<void>;
  chunks: string[];
  getStderr: () => string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}): Promise<void> {
  if (opts.timeoutId) clearTimeout(opts.timeoutId);
  await opts.handle.close().catch(() => {});
  try {
    await opts.cleanup();
  } catch {
    /* ignore cleanup errors during finalization */
  }

  if (opts.signal) {
    opts.reject(new Error(`Process terminated by signal ${opts.signal}`));
  } else if (opts.code === 0) {
    opts.resolve(opts.chunks.join(''));
  } else {
    opts.reject(
      processExitError(opts.code, opts.getStderr, () => opts.chunks.join('')),
    );
  }
}

export function isUsageLimit(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes('usage limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('quota will reset') ||
    lower.includes('credit balance is too low') ||
    lower.includes('out of extra usage') ||
    lower.includes('out of usage')
  );
}

export interface CLIAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  checkHealth(): Promise<CLIAdapterHealth>;
  execute(opts: {
    prompt: string;
    diff: string;
    model?: string;
    timeoutMs?: number;
    /** Optional callback for real-time output streaming */
    onOutput?: (chunk: string) => void;
    /** Whether to allow tool use for this adapter. Defaults to true. */
    allowToolUse?: boolean;
    /** Thinking budget level (off/low/medium/high). */
    thinkingBudget?: string;
  }): Promise<AdapterExecutionResult>;
  /**
   * Returns the project-scoped command directory path (relative to project root).
   * Returns null if the CLI only supports user-level commands.
   */
  getProjectCommandDir(): string | null;
  /**
   * Returns the user-level command directory path (absolute path).
   * Returns null if the CLI doesn't support user-level commands.
   */
  getUserCommandDir(): string | null;
  /**
   * Returns the project-scoped skill directory path (relative to project root).
   * Returns null if the CLI doesn't support the skills model.
   */
  getProjectSkillDir(): string | null;
  /**
   * Returns the user-level skill directory path (absolute path).
   * Returns null if the CLI doesn't support the skills model.
   */
  getUserSkillDir(): string | null;
  /**
   * Returns the command file extension used by this CLI.
   */
  getCommandExtension(): string;
  /**
   * Returns true if this adapter can use symlinks (same format as source Markdown).
   */
  canUseSymlink(): boolean;
  /**
   * Transforms validator command content to this CLI's format.
   * The source content is always Markdown with YAML frontmatter.
   */
  transformCommand(markdownContent: string): string;
  /**
   * Detect if the plugin is already installed.
   * Returns 'user' or 'project' scope if found, null otherwise.
   */
  detectPlugin?(projectRoot: string): Promise<'user' | 'project' | null>;
  /**
   * Install the plugin at the given scope.
   */
  installPlugin?(
    scope: 'user' | 'project',
    projectRoot?: string,
  ): Promise<{ success: boolean; error?: string }>;
  /**
   * Update the plugin at the given scope (re-copy assets, always overwrite).
   * Same signature as installPlugin.
   */
  updatePlugin?(
    scope: 'user' | 'project',
    projectRoot?: string,
  ): Promise<{ success: boolean; error?: string }>;
  /**
   * Get manual installation instructions for when automatic install fails.
   */
  getManualInstallInstructions?(scope: 'user' | 'project'): string[];
}
