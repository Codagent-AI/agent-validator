import { MetricsOperationError } from './errors.js';

/** Negotiation details survive the CLI boundary without parsing error text. */
export class MetricsVersionError extends MetricsOperationError {
  constructor(readonly required_measurement_schema_versions: number[]) {
    super(
      'unsupported_version',
      'Unsupported measurement schema version in pending evidence',
    );
  }
}
