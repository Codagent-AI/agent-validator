/** Stable protocol errors are independent of human diagnostic wording. */
export class MetricsOperationError extends Error {
  constructor(
    readonly code:
      | 'invalid_receipt'
      | 'scope_mismatch'
      | 'delivery_gap'
      | 'storage_corrupt'
      | 'unsupported_version'
      | 'store_busy',
    message: string,
  ) {
    super(message);
    this.name = 'MetricsOperationError';
  }
}

/** ENOENT only: permission, malformed-path, and storage failures stay distinct. */
export function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT',
  );
}
