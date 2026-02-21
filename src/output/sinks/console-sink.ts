import type { LogRecord, Sink } from '@logtape/logtape';
import chalk from 'chalk';

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
 * Format a log record with chalk colors for console output.
 * Level prefixes: [DEBUG] dim, [INFO] blue, [WARN] yellow, [ERROR] red
 */
function formatLogRecord(record: LogRecord): string {
  const level = record.level.toUpperCase();
  const category = record.category.join('.');
  const message = record.message
    .map((part) => (typeof part === 'string' ? part : safeStringify(part)))
    .join('');

  let levelStr: string;
  switch (record.level) {
    case 'debug':
      levelStr = chalk.dim(`[${level}]`);
      break;
    case 'info':
      levelStr = chalk.blue(`[${level}]`);
      break;
    case 'warning':
      levelStr = chalk.yellow(`[${level}]`);
      break;
    case 'error':
    case 'fatal':
      levelStr = chalk.red(`[${level}]`);
      break;
    default:
      levelStr = `[${level}]`;
  }

  const categoryStr = category ? chalk.dim(`[${category}]`) : '';

  return `${levelStr}${categoryStr} ${message}`;
}

/**
 * Create a console sink that outputs to stderr with chalk formatting.
 * Uses stderr to keep stdout clean for JSON protocol responses (stop-hook).
 */
export function createConsoleSink(): Sink {
  return (record: LogRecord) => {
    const formatted = formatLogRecord(record);
    console.error(formatted);
  };
}
