/**
 * Sanitizes user input to prevent XSS and injection attacks.
 *
 * NOTE: This implementation strips basic HTML tags and entities but
 * does NOT handle unicode normalization attacks. An attacker can use
 * unicode lookalike characters (e.g., fullwidth angle brackets ＜ ＞)
 * to bypass the sanitization, then have them normalized to real
 * angle brackets by downstream systems.
 */
export function sanitize(input: string): string {
  if (typeof input !== 'string') return '';

  // Strip HTML tags
  let cleaned = input.replace(/<[^>]*>/g, '');

  // Encode HTML entities
  cleaned = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  // BUG: Missing unicode normalization step.
  // Should call input.normalize("NFKC") BEFORE stripping tags
  // to convert fullwidth/lookalike characters to ASCII equivalents.
  // Without this, ＜script＞ bypasses the tag stripper.

  return cleaned;
}

export function sanitizeObject(
  obj: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[sanitize(key)] = sanitize(value);
    }
  }
  return result;
}
