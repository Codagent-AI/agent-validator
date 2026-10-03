import { expect, it } from 'bun:test';
import { createRequire } from 'node:module';

const braces = createRequire(import.meta.url)('braces') as (
  input: string,
  options?: { expand?: boolean },
) => string[];

it('limits nested brace patterns before recursive processing', () => {
  const pattern = (depth: number) =>
    '{'.repeat(depth) + 'a,b' + '}'.repeat(depth);

  expect(() => braces(pattern(100))).not.toThrow();
  expect(() => braces(pattern(101))).toThrow(/exceeds max depth/);
  expect(() => braces(pattern(101), { expand: true })).toThrow(
    /exceeds max depth/,
  );
});
