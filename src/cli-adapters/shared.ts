import { type ChildProcess, spawn } from 'node:child_process';
import type { FileHandle } from 'node:fs/promises';
import fs from 'node:fs/promises';

export interface CLIAdapterHealth {
  available: boolean;
  status: 'healthy' | 'missing' | 'unhealthy';
  message?: string;
}

/**
 * Collects stderr from a child process and returns a getter for the accumulated output.
 * Also forwards each chunk to the optional onOutput callback.
 */
export function collectStderr(
  child: ChildProcess,
  onOutput?: (text: string) => void,
): () => string {
  const chunks: string[] = [];
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    chunks.push(text);
    onOutput?.(text);
  });
  return () => chunks.join('');
}

/**
 * Builds an Error for a non-zero process exit, including stdout and stderr if available.
 * Both stdout and stderr are included to ensure usage limit messages are captured
 * regardless of which stream the CLI writes them to.
 */
export function processExitError(
  code: number | null,
  getStderr: () => string,
  getStdout?: () => string,
): Error {
  const stderr = getStderr();
  const stdout = getStdout?.() ?? '';
  const output = [stdout, stderr].filter(Boolean).join('\n');
  return new Error(
    `Process exited with code ${code}${output ? `\n${output}` : ''}`,
  );
}

export async function runStreamingCommand(opts: {
  command: string;
  args: string[];
  tmpFile: string;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
  cleanup: () => Promise<void>;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const inputStream = fs.open(opts.tmpFile, 'r').then((handle) => {
      const stream = handle.createReadStream();
      return { stream, handle };
    });

    inputStream
      .then(({ stream, handle }) => {
        const child = spawn(opts.command, opts.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: opts.env,
        });

        stream.pipe(child.stdin);

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (opts.timeoutMs) {
          timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Command timed out'));
          }, opts.timeoutMs);
        }

        child.stdout.on('data', (data: Buffer) => {
          const chunk = data.toString();
          chunks.push(chunk);
          opts.onOutput?.(chunk);
        });

        const getStderr = collectStderr(child, opts.onOutput);

        child.on('close', (code) => {
          void finalizeProcessClose({
            code,
            timeoutId,
            handle,
            cleanup: opts.cleanup,
            chunks,
            getStderr,
            resolve,
            reject,
          });
        });

        child.on('error', async (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          try {
            await handle.close();
          } catch {
            // ignore close errors
          }
          await opts.cleanup();
          reject(err);
        });
      })
      .catch(async (err) => {
        await opts.cleanup();
        reject(err);
      });
  });
}

export async function finalizeProcessClose(opts: {
  code: number | null;
  timeoutId?: ReturnType<typeof setTimeout>;
  handle: FileHandle;
  cleanup: () => Promise<void>;
  chunks: string[];
  getStderr: () => string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}): Promise<void> {
  if (opts.timeoutId) clearTimeout(opts.timeoutId);
  await opts.handle.close().catch(() => {});
  await opts.cleanup();

  if (opts.code === 0 || opts.code === null) {
    opts.resolve(opts.chunks.join(''));
  } else {
    opts.reject(
      processExitError(opts.code, opts.getStderr, () => opts.chunks.join('')),
    );
  }
}

export function isUsageLimit(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes('usage limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('quota will reset') ||
    lower.includes('credit balance is too low') ||
    lower.includes('out of extra usage') ||
    lower.includes('out of usage')
  );
}

export interface CLIAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  checkHealth(): Promise<CLIAdapterHealth>;
  execute(opts: {
    prompt: string;
    diff: string;
    model?: string;
    timeoutMs?: number;
    /** Optional callback for real-time output streaming */
    onOutput?: (chunk: string) => void;
    /** Whether to allow tool use for this adapter. Defaults to true. */
    allowToolUse?: boolean;
    /** Thinking budget level (off/low/medium/high). */
    thinkingBudget?: string;
  }): Promise<string>;
  /**
   * Returns the project-scoped command directory path (relative to project root).
   * Returns null if the CLI only supports user-level commands.
   */
  getProjectCommandDir(): string | null;
  /**
   * Returns the user-level command directory path (absolute path).
   * Returns null if the CLI doesn't support user-level commands.
   */
  getUserCommandDir(): string | null;
  /**
   * Returns the project-scoped skill directory path (relative to project root).
   * Returns null if the CLI doesn't support the skills model.
   */
  getProjectSkillDir(): string | null;
  /**
   * Returns the user-level skill directory path (absolute path).
   * Returns null if the CLI doesn't support the skills model.
   */
  getUserSkillDir(): string | null;
  /**
   * Returns the command file extension used by this CLI.
   */
  getCommandExtension(): string;
  /**
   * Returns true if this adapter can use symlinks (same format as source Markdown).
   */
  canUseSymlink(): boolean;
  /**
   * Transforms gauntlet command content to this CLI's format.
   * The source content is always Markdown with YAML frontmatter.
   */
  transformCommand(markdownContent: string): string;
  /**
   * Returns true if this CLI supports hooks (stop hook, start hook).
   */
  supportsHooks(): boolean;
}
