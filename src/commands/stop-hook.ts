import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { loadGlobalConfig } from '../config/global.js';
import { ClaudeStopHookAdapter } from '../hooks/adapters/claude-stop-hook.js';
import { CursorStopHookAdapter } from '../hooks/adapters/cursor-stop-hook.js';
import type {
  StopHookAdapter,
  StopHookResult,
} from '../hooks/adapters/types.js';
import {
  getDebugLogConfig,
  getLogDir,
  getStatusMessage,
  StopHookHandler,
} from '../hooks/stop-hook-handler.js';
import {
  LOOP_THRESHOLD,
  recordBlockTimestamp,
  resetBlockTimestamps,
} from '../hooks/stop-hook-state.js';
import {
  getCategoryLogger,
  initLogger,
  resetLogger,
} from '../output/app-logger.js';
import {
  type GauntletStatus,
  isBlockingStatus,
} from '../types/gauntlet-status.js';
import { DebugLogger, mergeDebugLogConfig } from '../utils/debug-log.js';

const STDIN_TIMEOUT_MS = 5000;
export const GAUNTLET_STOP_HOOK_ACTIVE_ENV = 'GAUNTLET_STOP_HOOK_ACTIVE';

const STOP_HOOK_MARKER_FILE = '.stop-hook-active';
const STOP_HOOK_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_MARKER_MS = 10 * 60 * 1000;
const adapters: StopHookAdapter[] = [
  new CursorStopHookAdapter(),
  new ClaudeStopHookAdapter(),
];

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;

    const onEnd = () => cleanup(data.trim());
    const onError = () => cleanup('');

    const cleanup = (result: string) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('end', onEnd);
        process.stdin.removeListener('error', onError);
        resolve(result);
      }
    };

    const timeout = setTimeout(() => {
      cleanup(data.trim());
    }, STDIN_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      data += chunk.toString();
      if (data.includes('\n')) {
        cleanup(data.trim());
      }
    };

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);

    if (process.stdin.readableEnded) {
      cleanup(data.trim());
    }
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function getStopHookLogger() {
  return getCategoryLogger('stop-hook');
}

function outputResult(adapter: StopHookAdapter, result: StopHookResult): void {
  console.log(adapter.formatOutput(result));
}

function createEarlyExitResult(
  status: GauntletStatus,
  options?: { intervalMinutes?: number; errorMessage?: string },
): StopHookResult {
  return {
    status,
    shouldBlock: false,
    message: getStatusMessage(status, options),
    intervalMinutes: options?.intervalMinutes,
  };
}

async function applyLoopDetection(
  result: StopHookResult,
  logDir: string,
  log: ReturnType<typeof getStopHookLogger>,
  debugLogger: DebugLogger | null,
): Promise<StopHookResult> {
  if (!result.shouldBlock) {
    resetBlockTimestamps(logDir).catch(() => {});
    return result;
  }
  try {
    const timestamps = await recordBlockTimestamp(logDir);
    if (timestamps.length >= LOOP_THRESHOLD) {
      log.info(
        `Loop detected: ${timestamps.length} blocks within window — overriding to allow`,
      );
      await debugLogger?.logStopHook('allow', 'loop_detected');
      return {
        status: 'loop_detected',
        shouldBlock: false,
        message: getStatusMessage('loop_detected'),
      };
    }
  } catch (loopErr: unknown) {
    const errMsg = (loopErr as { message?: string }).message ?? 'unknown';
    log.warn(
      `Loop detection error: ${errMsg} — proceeding with original result`,
    );
  }
  return result;
}

export function outputHookResponse(
  status: GauntletStatus,
  options?: {
    reason?: string;
    intervalMinutes?: number;
    errorMessage?: string;
  },
): void {
  const claudeAdapter = new ClaudeStopHookAdapter();
  const shouldBlock = isBlockingStatus(status);
  const message = getStatusMessage(status, {
    intervalMinutes: options?.intervalMinutes,
    errorMessage: options?.errorMessage,
  });

  const result: StopHookResult = {
    status,
    shouldBlock,
    message,
    reason: options?.reason,
    intervalMinutes: options?.intervalMinutes,
  };

  console.log(claudeAdapter.formatOutput(result));
}

export { getStatusMessage };
export type {
  GauntletStatus as StopHookStatus,
  StopHookResult as HookResponse,
};

interface StopHookContext {
  adapter: StopHookAdapter;
  debugLogger: DebugLogger | null;
  loggerInitialized: boolean;
  markerFilePath: string | null;
  log: ReturnType<typeof getStopHookLogger>;
}

async function initDebugLogger(
  logDir: string,
  projectCwd: string,
  log: ReturnType<typeof getStopHookLogger>,
): Promise<DebugLogger | null> {
  try {
    const globalConfig = await loadGlobalConfig();
    const projectDebugLogConfig = await getDebugLogConfig(projectCwd);
    const debugLogConfig = mergeDebugLogConfig(
      projectDebugLogConfig,
      globalConfig.debug_log,
    );
    return new DebugLogger(logDir, debugLogConfig);
  } catch (initErr: unknown) {
    log.warn(
      `Debug logger init failed: ${(initErr as { message?: string }).message ?? 'unknown'}`,
    );
    return null;
  }
}

async function checkMarkerFile(
  markerPath: string,
  debugLogger: DebugLogger | null,
): Promise<StopHookResult | null> {
  if (!(await fileExists(markerPath))) return null;

  try {
    const stat = await fs.stat(markerPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > STALE_MARKER_MS) {
      await debugLogger?.logStopHookEarlyExit(
        'marker_stale',
        'proceeding',
        `age=${Math.round(ageMs / 1000)}s threshold=${Math.round(STALE_MARKER_MS / 1000)}s`,
      );
      await fs.rm(markerPath, { force: true });
      return null;
    }
    await debugLogger?.logStopHookEarlyExit(
      'marker_fresh',
      'stop_hook_active',
      `age=${Math.round(ageMs / 1000)}s`,
    );
    return createEarlyExitResult('stop_hook_active');
  } catch (markerErr: unknown) {
    const errMsg = (markerErr as { message?: string }).message ?? 'unknown';
    await debugLogger?.logStopHookEarlyExit(
      'marker_stat_error',
      'stop_hook_active',
      `error=${errMsg}`,
    );
    return createEarlyExitResult('stop_hook_active');
  }
}

/** Diagnostic info captured early for later logging. */
interface StopHookDiagnostics {
  pid: number;
  ppid: number;
  envVarSet: boolean;
  processCwd: string;
  rawStdin: string;
  stdinSessionId: string | undefined;
  stdinStopHookActive: boolean | undefined;
  stdinCwd: string | undefined;
  stdinHookEventName: string | undefined;
}

/** Parse stdin input and populate diagnostics. Returns null on parse failure. */
async function parseStdinInput(
  ctx: StopHookContext,
  diagnostics: StopHookDiagnostics,
): Promise<Record<string, unknown> | null> {
  const input = await readStdin();
  diagnostics.rawStdin = input;

  try {
    if (!input.trim()) return {};
    const parsed = JSON.parse(input) as Record<string, unknown>;
    diagnostics.stdinSessionId = parsed.session_id as string | undefined;
    diagnostics.stdinStopHookActive = parsed.stop_hook_active as
      | boolean
      | undefined;
    diagnostics.stdinCwd = parsed.cwd as string | undefined;
    diagnostics.stdinHookEventName = parsed.hook_event_name as
      | string
      | undefined;
    return parsed;
  } catch (parseErr: unknown) {
    const errMsg = (parseErr as { message?: string }).message ?? 'unknown';
    ctx.log.info(`Invalid hook input (${errMsg}), allowing stop`);
    await ctx.debugLogger?.logStopHookEarlyExit(
      'stdin_parse_error',
      'invalid_input',
      `error=${errMsg}`,
    );
    outputResult(ctx.adapter, createEarlyExitResult('invalid_input'));
    return null;
  }
}

/** Execute the gauntlet and produce a result. */
async function executeGauntlet(
  ctx: StopHookContext,
  projectCwd: string,
  logDir: string,
  diagnostics: StopHookDiagnostics,
  parsedInput: Record<string, unknown>,
): Promise<void> {
  // biome-ignore lint/style/noNonNullAssertion: adapters array always has index 1
  ctx.adapter = adapters.find((a) => a.detect(parsedInput)) ?? adapters[1]!;
  const adapterCtx = ctx.adapter.parseInput(parsedInput);
  const skipResult = ctx.adapter.shouldSkipExecution(adapterCtx);
  if (skipResult) {
    await ctx.debugLogger?.logStopHookEarlyExit(
      'adapter_skip',
      skipResult.status,
      `adapter=${ctx.adapter.name}`,
    );
    outputResult(ctx.adapter, skipResult);
    return;
  }

  ctx.log.info('Starting gauntlet validation...');
  if (adapterCtx.cwd !== process.cwd()) {
    const configPath = path.join(projectCwd, '.gauntlet', 'config.yml');
    if (!(await fileExists(configPath))) {
      ctx.log.info('No gauntlet config found at hook cwd, allowing stop');
      await ctx.debugLogger?.logStopHookEarlyExit(
        'no_config_at_cwd',
        'no_config',
        `cwd=${projectCwd}`,
      );
      outputResult(ctx.adapter, createEarlyExitResult('no_config'));
      return;
    }
  }

  await initLogger({ mode: 'stop-hook', logDir });
  ctx.loggerInitialized = true;
  const earlyLogDir = path.join(process.cwd(), await getLogDir(process.cwd()));
  if (logDir !== earlyLogDir) {
    ctx.debugLogger =
      (await initDebugLogger(logDir, projectCwd, ctx.log)) ?? ctx.debugLogger;
  }

  await ctx.debugLogger?.logStopHookDiagnostics(diagnostics);
  ctx.markerFilePath = path.join(logDir, STOP_HOOK_MARKER_FILE);
  try {
    await fs.writeFile(ctx.markerFilePath, `${process.pid}`, 'utf-8');
  } catch (mkErr: unknown) {
    const errMsg = (mkErr as { message?: string }).message ?? 'unknown';
    ctx.log.warn(`Failed to create marker file: ${errMsg}`);
    ctx.markerFilePath = null;
  }

  ctx.log.info('Running gauntlet gates...');
  const handler = new StopHookHandler(ctx.debugLogger ?? undefined);
  handler.setLogDir(logDir);
  let result: StopHookResult;
  try {
    result = await handler.execute(adapterCtx);
  } finally {
    await removeMarkerFile(ctx);
  }

  result = await applyLoopDetection(result, logDir, ctx.log, ctx.debugLogger);
  outputResult(ctx.adapter, result);
  await safeResetLogger(ctx);
}

/** Remove marker file if it exists. */
async function removeMarkerFile(ctx: StopHookContext): Promise<void> {
  if (!ctx.markerFilePath) return;
  try {
    await fs.rm(ctx.markerFilePath, { force: true });
  } catch (rmErr: unknown) {
    const errMsg = (rmErr as { message?: string }).message ?? 'unknown';
    ctx.log.warn(`Failed to remove marker file: ${errMsg}`);
  }
  ctx.markerFilePath = null;
}

async function safeResetLogger(ctx: StopHookContext): Promise<void> {
  if (!ctx.loggerInitialized) return;
  try {
    await resetLogger();
  } catch (resetErr: unknown) {
    const resetMsg = (resetErr as { message?: string }).message ?? 'unknown';
    ctx.log.warn(`Logger reset failed: ${resetMsg}`);
  }
}

/** Handle errors in the stop hook action. */
async function handleStopHookError(
  ctx: StopHookContext,
  error: unknown,
): Promise<void> {
  const err = error as { message?: string };
  const errorMessage = err.message || 'unknown error';
  ctx.log.error(`Stop hook error: ${errorMessage}`);
  await ctx.debugLogger?.logStopHook('allow', `error: ${errorMessage}`);
  outputResult(ctx.adapter, createEarlyExitResult('error', { errorMessage }));
  await removeMarkerFile(ctx);

  if (ctx.loggerInitialized) {
    try {
      await resetLogger();
    } catch (resetErr: unknown) {
      const resetMsg = (resetErr as { message?: string }).message ?? 'unknown';
      process.stderr.write(`stop-hook: logger reset failed: ${resetMsg}\n`);
    }
  }
}

export function registerStopHookCommand(program: Command): void {
  program
    .command('stop-hook')
    .description('Claude Code stop hook - validates gauntlet completion')
    .action(async () => {
      const ctx: StopHookContext = {
        adapter: adapters[1] as StopHookAdapter,
        debugLogger: null,
        loggerInitialized: false,
        markerFilePath: null,
        log: getStopHookLogger(),
      };

      const selfTimeout = setTimeout(() => {
        if (ctx.markerFilePath) {
          try {
            fsSync.rmSync(ctx.markerFilePath, { force: true });
          } catch {
            // Best-effort cleanup
          }
        }
        outputResult(
          ctx.adapter,
          createEarlyExitResult('error', {
            errorMessage: 'stop hook timed out',
          }),
        );
        process.exit(0);
      }, STOP_HOOK_TIMEOUT_MS);
      selfTimeout.unref();

      try {
        await handleStopHookAction(ctx);
      } catch (error: unknown) {
        await handleStopHookError(ctx, error);
      } finally {
        clearTimeout(selfTimeout);
      }
    });
}

/** Main stop-hook action logic, broken into phases. */
async function handleStopHookAction(ctx: StopHookContext): Promise<void> {
  // Phase 1: Fast exit checks
  if (process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV]) {
    outputResult(ctx.adapter, createEarlyExitResult('stop_hook_active'));
    return;
  }

  const quickConfigCheck = path.join(process.cwd(), '.gauntlet', 'config.yml');
  if (!(await fileExists(quickConfigCheck))) {
    outputResult(ctx.adapter, createEarlyExitResult('no_config'));
    return;
  }

  // Phase 2: Initialize debug logger
  const earlyLogDir = path.join(process.cwd(), await getLogDir(process.cwd()));
  ctx.debugLogger = await initDebugLogger(earlyLogDir, process.cwd(), ctx.log);
  await ctx.debugLogger?.logCommand('stop-hook', []);

  // Phase 3: Check marker file
  const markerLogDir = await getLogDir(process.cwd());
  const markerPath = path.join(
    process.cwd(),
    markerLogDir,
    STOP_HOOK_MARKER_FILE,
  );
  const markerResult = await checkMarkerFile(markerPath, ctx.debugLogger);
  if (markerResult) {
    outputResult(ctx.adapter, markerResult);
    return;
  }

  // Phase 4: Parse stdin
  const diagnostics: StopHookDiagnostics = {
    pid: process.pid,
    ppid: process.ppid,
    envVarSet: !!process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV],
    processCwd: process.cwd(),
    rawStdin: '',
    stdinSessionId: undefined,
    stdinStopHookActive: undefined,
    stdinCwd: undefined,
    stdinHookEventName: undefined,
  };

  const parsed = await parseStdinInput(ctx, diagnostics);
  if (parsed === null) return;
  const projectCwd = (parsed.cwd as string) || process.cwd();
  const logDir = path.join(projectCwd, await getLogDir(projectCwd));
  await executeGauntlet(ctx, projectCwd, logDir, diagnostics, parsed);
}
