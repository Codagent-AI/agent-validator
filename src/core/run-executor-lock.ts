import fs from 'node:fs/promises';
import path from 'node:path';

const LOCK_FILENAME = '.gauntlet-run.lock';
const STALE_LOCK_MS = 10 * 60 * 1000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'EPERM'
    ) {
      return true;
    }
    return false;
  }
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const lockContent = await fs.readFile(lockPath, 'utf-8');
    const lockPid = Number.parseInt(lockContent.trim(), 10);
    const lockStat = await fs.stat(lockPath);
    const lockAgeMs = Date.now() - lockStat.mtimeMs;

    const pidValid = !Number.isNaN(lockPid);
    if (pidValid && !isProcessAlive(lockPid)) {
      return true;
    }
    if (!pidValid && lockAgeMs > STALE_LOCK_MS) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Acquire the lock file. Returns true if successful, false if lock exists. */
export async function tryAcquireLock(logDir: string): Promise<boolean> {
  await fs.mkdir(logDir, { recursive: true });
  const lockPath = path.resolve(logDir, LOCK_FILENAME);
  try {
    await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err: unknown) {
    const isExist =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'EEXIST';

    if (!isExist) {
      throw err;
    }

    const stale = await isLockStale(lockPath);
    if (!stale) {
      return false;
    }

    await fs.rm(lockPath, { force: true });
    try {
      await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }
}

/** Find the latest console.N.log file in the log directory. */
export async function findLatestConsoleLog(
  logDir: string,
): Promise<string | null> {
  try {
    const files = await fs.readdir(logDir);
    let maxNum = -1;
    let latestFile: string | null = null;

    for (const file of files) {
      if (!(file.startsWith('console.') && file.endsWith('.log'))) {
        continue;
      }
      const middle = file.slice('console.'.length, file.length - '.log'.length);
      if (/^\d+$/.test(middle)) {
        const n = Number.parseInt(middle, 10);
        if (n > maxNum) {
          maxNum = n;
          latestFile = file;
        }
      }
    }

    return latestFile ? path.join(logDir, latestFile) : null;
  } catch {
    return null;
  }
}
