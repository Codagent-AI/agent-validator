import fs from 'node:fs';
import type { LogRecord, Sink } from '@logtape/logtape';

// biome-ignore lint/suspicious/noControlCharactersInRegex: Required for ANSI escape code stripping
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escape codes from text.
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/**
 * Format an ISO timestamp for log output.
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Safely serialize a value, handling circular references.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[Unserializable]';
  }
}

/**
 * Format a log record for file output with plain text (no ANSI).
 * Format: [ISO_TIMESTAMP] LEVEL [category] message
 */
function formatLogRecord(record: LogRecord): string {
  const timestamp = formatTimestamp(record.timestamp);
  const level = record.level.toUpperCase().padEnd(7);
  const category = record.category.join('.');
  const message = record.message
    .map((part) => (typeof part === 'string' ? part : safeStringify(part)))
    .join('');

  // Strip any ANSI codes that might be in the message
  const cleanMessage = stripAnsi(message);

  const categoryStr = category ? `[${category}] ` : '';
  return `[${timestamp}] ${level} ${categoryStr}${cleanMessage}\n`;
}

/**
 * Create a file sink that appends to the specified log file.
 * Uses synchronous writes to ensure log ordering.
 *
 * @param logPath - Path to the log file (e.g., console.N.log)
 */
export function createFileSink(logPath: string): Sink {
  // Ensure the file exists (create if not)
  const fd = fs.openSync(
    logPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND,
  );

  return (record: LogRecord) => {
    const formatted = formatLogRecord(record);
    try {
      fs.writeSync(fd, formatted);
    } catch {
      // Suppress write errors to avoid crashing the application
    }
  };
}

/**
 * Create a closeable file sink that can be cleaned up.
 * Returns both the sink and a close function.
 */
export function createCloseableFileSink(logPath: string): {
  sink: Sink;
  close: () => void;
} {
  const fd = fs.openSync(
    logPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND,
  );
  let isClosed = false;

  const sink: Sink = (record: LogRecord) => {
    if (isClosed) return;
    const formatted = formatLogRecord(record);
    try {
      fs.writeSync(fd, formatted);
    } catch {
      // Suppress write errors
    }
  };

  const close = () => {
    if (!isClosed) {
      isClosed = true;
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors
      }
    }
  };

  return { sink, close };
}
