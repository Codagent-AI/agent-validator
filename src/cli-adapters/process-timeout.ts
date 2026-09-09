import type { ChildProcess } from 'node:child_process';

/** Bounded graceful termination lets providers flush final evidence before close. */
export function armCommandTimeout(
  child: ChildProcess,
  timeoutMs: number | undefined,
  forceFinish: () => void,
) {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        timer = setTimeout(() => {
          // Descendants can retain inherited pipes after their parent exits.
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.stdin?.destroy();
          child.unref();
          forceFinish();
        }, 1000);
      }, 1000);
    }, timeoutMs);
  }
  return {
    get timedOut() {
      return timedOut;
    },
    clear: () => {
      if (timer) clearTimeout(timer);
    },
  };
}
