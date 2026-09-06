import { createHash } from 'node:crypto';
import type { Digest } from './types.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function invalidUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/** RFC 8785-compatible JSON serialization for JSON values accepted by this contract. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'string') {
    if (invalidUnicode(value)) throw new Error('Invalid Unicode string');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  if (typeof value === 'object' && value !== undefined) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${canonicalizeJson(key)}:${canonicalizeJson(object[key])}`)
      .join(',')}}`;
  }
  throw new Error(`Unsupported JSON value: ${typeof value}`);
}

/** Parses JSON while detecting duplicate keys before normal parsing can discard them. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The nested JSON grammar shares a cursor and safely rejects duplicates.
export function parseJsonStrict(input: string): Json {
  let index = 0;
  const whitespace = () => {
    while (/\s/.test(input[index] ?? '')) index++;
  };
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: JSON grammar dispatch must preserve exact parser position.
  const value = (): Json => {
    whitespace();
    const char = input[index];
    if (char === '"') return string();
    if (char === '{') return object();
    if (char === '[') return array();
    if (input.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (input.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (input.startsWith('null', index)) {
      index += 4;
      return null;
    }
    const token = input
      .slice(index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
    if (!token) throw new Error(`Invalid JSON at offset ${index}`);
    index += token.length;
    const number = Number(token);
    if (!Number.isFinite(number))
      throw new Error('JSON numbers must be finite');
    return number;
  };
  const string = (): string => {
    const start = index++;
    let escaped = false;
    while (index < input.length) {
      const char = input[index++];
      if (!escaped && char === '"') break;
      escaped = !escaped && char === '\\';
      if (char !== '\\') escaped = false;
    }
    const raw = input.slice(start, index);
    let parsed: string;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON string at offset ${start}`);
    }
    if (invalidUnicode(parsed)) throw new Error('Invalid Unicode string');
    return parsed;
  };
  const array = (): Json[] => {
    index++;
    const result: Json[] = [];
    whitespace();
    if (input[index] === ']') {
      index++;
      return result;
    }
    while (true) {
      result.push(value());
      whitespace();
      if (input[index] === ']') {
        index++;
        return result;
      }
      if (input[index++] !== ',')
        throw new Error(`Expected comma at offset ${index - 1}`);
    }
  };
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Object parsing detects duplicate keys before their values are retained.
  const object = (): { [key: string]: Json } => {
    index++;
    const result: { [key: string]: Json } = {};
    const seen = new Set<string>();
    whitespace();
    if (input[index] === '}') {
      index++;
      return result;
    }
    while (true) {
      whitespace();
      if (input[index] !== '"')
        throw new Error(`Expected object key at offset ${index}`);
      const key = string();
      if (seen.has(key)) throw new Error(`Duplicate object key: ${key}`);
      seen.add(key);
      whitespace();
      if (input[index++] !== ':')
        throw new Error(`Expected colon at offset ${index - 1}`);
      result[key] = value();
      whitespace();
      if (input[index] === '}') {
        index++;
        return result;
      }
      if (input[index++] !== ',')
        throw new Error(`Expected comma at offset ${index - 1}`);
    }
  };
  const parsed = value();
  whitespace();
  if (index !== input.length)
    throw new Error(`Trailing JSON at offset ${index}`);
  return parsed;
}

export function createDigest(record: object): Digest {
  const { digest: _digest, ...withoutDigest } = record as Record<
    string,
    unknown
  >;
  const canonical = canonicalizeJson(withoutDigest);
  return {
    algorithm: 'sha256',
    canonicalization: 'rfc8785',
    value: createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}
export function verifyDigest(record: object): {
  valid: boolean;
  expected: Digest;
} {
  const expected = createDigest(record);
  const actual = (record as Record<string, unknown>).digest as
    | Digest
    | undefined;
  return {
    valid:
      actual?.algorithm === 'sha256' &&
      actual.canonicalization === 'rfc8785' &&
      actual.value === expected.value,
    expected,
  };
}
