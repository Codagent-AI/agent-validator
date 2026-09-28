import os from 'node:os';
import path from 'node:path';

// Provider IDs enter metrics identity, so reject values resembling private evidence.
const PRIVATE_PROVIDER_ID =
  /(?:prompt|response|credential|password|api[_ -]?key|account|user|organization|email|host|machine)/i;
const SAFE_PROVIDER_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function isSafeCodexProviderId(value: string): boolean {
  return (
    SAFE_PROVIDER_ID_PATTERN.test(value) && !PRIVATE_PROVIDER_ID.test(value)
  );
}

export function resolveCodexHome(env: NodeJS.ProcessEnv, cwd: string): string {
  return path.resolve(cwd, env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}
