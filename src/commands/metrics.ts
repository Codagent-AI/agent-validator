import type { Command } from 'commander';
import { resolveMetricsLocation } from '../config/metrics-location.js';
import { MetricsOperationError } from '../metrics/errors.js';
import { MetricsStore } from '../metrics/store.js';
import {
  ARTIFACT_SCHEMA_VERSION,
  CAPABILITIES_VERSION,
  MEASUREMENT_SCHEMA_VERSION,
  PROTOCOL_VERSION,
} from '../metrics/types.js';

const limits = {
  default_inventory_count: 100,
  maximum_inventory_count: 500,
  default_export_count: 100,
  maximum_export_count: 500,
  default_export_bytes: 1_000_000,
  maximum_export_bytes: 4_000_000,
  maximum_individual_record_bytes: 3_000_000,
};

type SharedOptions = {
  project?: string;
  config?: string;
  consumer?: string;
  context?: string;
  protocolVersion?: string;
  receipt?: string;
  measurementVersion?: string[];
  maxRecords?: string;
  maxBytes?: string;
  confirm?: boolean;
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Commander keeps the public command grammar together.
export function registerMetricsCommand(program: Command): void {
  const metrics = program
    .command('metrics')
    .description('Retrieve retained validation metrics');
  metrics
    .command('capabilities')
    .description('Show metrics protocol capabilities')
    .action(() => {
      write({
        ok: true,
        operation: 'capabilities',
        protocol_version: PROTOCOL_VERSION,
        capabilities_version: CAPABILITIES_VERSION,
        producer: { name: 'agent-validator' },
        protocol_versions: [PROTOCOL_VERSION],
        measurement_schema_versions: [MEASUREMENT_SCHEMA_VERSION],
        artifact_schema_versions: [ARTIFACT_SCHEMA_VERSION],
        operations: [
          'capabilities',
          'pending',
          'export',
          'acknowledge',
          'discard',
        ],
        limits,
        diagnostics: [],
      });
    });
  metrics
    .command('export')
    .description('Export a bounded pending batch')
    .option('--project <dir>')
    .option('--config <file>')
    .option('--consumer <name>')
    .option('--context <id>')
    .option('--protocol-version <version>')
    .option(
      '--measurement-version <version>',
      'Supported measurement version',
      collect,
      [],
    )
    .option('--max-records <count>')
    .option('--max-bytes <count>')
    .action((options: SharedOptions) =>
      operation('export', options, async (store, shared) => {
        const result = await store.exportPending({
          ...shared,
          measurementVersions: versions(options.measurementVersion),
          maxRecords: bounded(options.maxRecords, limits.maximum_export_count),
          maxBytes: bounded(options.maxBytes, limits.maximum_export_bytes),
        });
        return {
          ...result,
          measurement_schema_versions: [
            ...new Set(
              result.records.map((record) => record.measurement_schema_version),
            ),
          ],
        };
      }),
    );
  metrics
    .command('acknowledge')
    .description('Acknowledge one exported receipt')
    .option('--project <dir>')
    .option('--config <file>')
    .option('--consumer <name>')
    .option('--context <id>')
    .option('--protocol-version <version>')
    .option('--receipt <opaque-token>')
    .action((options: SharedOptions) =>
      operation('acknowledge', options, async (store, shared) => {
        if (!options.receipt) throw new Error('receipt is required');
        await store.acknowledgeReceipt({
          ...shared,
          receipt: options.receipt,
        });
        return { receipt: options.receipt, disposition: 'acknowledged' };
      }),
    );
  metrics
    .command('discard')
    .description('Discard exactly one exported receipt')
    .option('--project <dir>')
    .option('--config <file>')
    .option('--consumer <name>')
    .option('--context <id>')
    .option('--protocol-version <version>')
    .option('--receipt <opaque-token>')
    .option('--confirm')
    .action((options: SharedOptions) =>
      operation('discard', options, async (store, shared) => {
        if (!options.confirm) throw new Error('Discard requires --confirm');
        if (!options.receipt) throw new Error('receipt is required');
        await store.discardReceipt({ ...shared, receipt: options.receipt });
        return { receipt: options.receipt, disposition: 'discarded' };
      }),
    );
  // Pending deliberately resolves no store through the normal create path, so
  // missing delivery stays distinct from an empty committed inventory.
  metrics
    .command('pending')
    .description('List pending delivery contexts')
    .option('--project <dir>')
    .option('--config <file>')
    .option('--protocol-version <version>')
    .option('--consumer <name>')
    .option('--after <cursor>')
    .option('--limit <count>')
    .action((options: SharedOptions) => pending(options));
}

async function operation(
  name: string,
  options: SharedOptions,
  action: (
    store: MetricsStore,
    shared: { consumer: string; context: string; protocolVersion: number },
  ) => Promise<object>,
): Promise<void> {
  try {
    const shared = scoped(options);
    const location = await resolveMetricsLocation(
      options.project,
      options.config,
    );
    const store = await MetricsStore.openExisting(location.logDir);
    write({
      ok: true,
      operation: name,
      protocol_version: PROTOCOL_VERSION,
      producer: { name: 'agent-validator' },
      diagnostics: [],
      ...(await action(store, shared)),
    });
  } catch (error) {
    fail(name, error);
  }
}

async function pending(options: SharedOptions): Promise<void> {
  try {
    if (Number(options.protocolVersion) !== PROTOCOL_VERSION)
      throw new Error('Unsupported metrics protocol version');
    const location = await resolveMetricsLocation(
      options.project,
      options.config,
    );
    const inventory = await MetricsStore.openExisting(location.logDir).then(
      (store) => store.pendingInventory(options.consumer),
    );
    const limit =
      bounded(
        (options as SharedOptions & { limit?: string }).limit,
        limits.maximum_inventory_count,
      ) ?? limits.default_inventory_count;
    const cursor = decodeCursor(
      (options as SharedOptions & { after?: string }).after,
      inventory.store_id,
      options.consumer,
    );
    const start = cursor
      ? inventory.contexts.findIndex(
          (entry) =>
            entry.consumer === cursor.consumer &&
            entry.context === cursor.context,
        ) + 1
      : 0;
    const contexts = inventory.contexts.slice(
      Math.max(start, 0),
      Math.max(start, 0) + limit,
    );
    const last = contexts.at(-1);
    write({
      ok: true,
      operation: 'pending',
      protocol_version: PROTOCOL_VERSION,
      producer: { name: 'agent-validator' },
      store_id: inventory.store_id,
      inventory_generation: inventory.inventory_generation,
      contexts,
      next_cursor:
        last && start + contexts.length < inventory.contexts.length
          ? encodeCursor(inventory.store_id, options.consumer, last)
          : null,
      diagnostics: [],
    });
  } catch (error) {
    fail('pending', error);
  }
}

function scoped(options: SharedOptions) {
  if (!(options.consumer && options.context))
    throw new Error('consumer and context are required');
  const protocolVersion = Number(options.protocolVersion);
  if (protocolVersion !== PROTOCOL_VERSION)
    throw new Error('Unsupported metrics protocol version');
  return {
    consumer: options.consumer,
    context: options.context,
    protocolVersion,
  };
}
function versions(values: string[] | undefined): number[] {
  const result = (values ?? []).map(Number);
  if (
    result.length === 0 ||
    result.some((value) => value !== MEASUREMENT_SCHEMA_VERSION)
  )
    throw new Error('Unsupported measurement schema version');
  return result;
}
function bounded(
  value: string | undefined,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new Error('Invalid bounded limit');
  return parsed;
}
function encodeCursor(
  storeId: string,
  filter: string | undefined,
  context: { consumer: string; context: string },
): string {
  return Buffer.from(
    JSON.stringify({
      storeId,
      filter: filter ?? null,
      consumer: context.consumer,
      context: context.context,
    }),
  ).toString('base64url');
}
function decodeCursor(
  value: string | undefined,
  storeId: string,
  filter: string | undefined,
): { consumer: string; context: string } | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as {
      storeId?: string;
      filter?: string | null;
      consumer?: string;
      context?: string;
    };
    if (
      decoded.storeId !== storeId ||
      decoded.filter !== (filter ?? null) ||
      !decoded.consumer ||
      !decoded.context
    )
      throw new Error();
    return { consumer: decoded.consumer, context: decoded.context };
  } catch {
    throw new Error('Invalid inventory cursor');
  }
}
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
function write(value: object): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
function fail(operation: string, error: unknown): void {
  const message =
    error instanceof Error ? error.message : 'Metrics operation failed';
  const code =
    error instanceof MetricsOperationError ? error.code : errorCode(message);
  write({
    ok: false,
    operation,
    protocol_version: PROTOCOL_VERSION,
    diagnostics: [],
    error: { code, message, retryable: code === 'store_busy' },
  });
  process.exitCode = 1;
}

function errorCode(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('scope')) return 'scope_mismatch';
  if (normalized.includes('invalid metrics receipt')) return 'invalid_receipt';
  if (normalized.includes('unsupported')) return 'unsupported_version';
  if (
    normalized.includes('invalid') ||
    normalized.includes('required') ||
    normalized.includes('--confirm')
  )
    return 'invalid_arguments';
  if (normalized.includes('receipt')) return 'invalid_receipt';
  if (normalized.includes('configuration')) return 'configuration_unavailable';
  if (normalized.includes('lock')) return 'store_busy';
  return 'storage_unavailable';
}
