// Limit retained telemetry fragments to 1 Mi UTF-16 code units. The review
// output itself remains owned by the command runner, not this collector.
const MAX_LINE_LENGTH = 1024 * 1024;

/** Consume newline-delimited records once, dropping oversized lines in full. */
export function createBoundedLineCollector(onLine: (line: string) => void) {
  let fragments: string[] = [];
  let length = 0;
  let discarding = false;
  let closed = false;

  const append = (chunk: string, start: number, end: number): void => {
    if (discarding || end === start) return;
    length += end - start;
    if (length > MAX_LINE_LENGTH) {
      fragments = [];
      discarding = true;
    } else {
      fragments.push(chunk.slice(start, end));
    }
  };

  const emit = (): void => {
    const line = discarding ? undefined : fragments.join('');
    fragments = [];
    length = 0;
    discarding = false;
    if (line) onLine(line);
  };

  const write = (chunk: string): void => {
    if (closed) return;
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf('\n', start);
      const end = newline === -1 ? chunk.length : newline;
      append(chunk, start, end);
      if (newline === -1) return;
      emit();
      start = newline + 1;
    }
  };

  const flush = (): void => {
    if (closed) return;
    closed = true;
    emit();
  };

  return { write, flush };
}
