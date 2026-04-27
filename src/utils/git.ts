import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { loadConfig } from '../config/loader.js';

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runGit(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; trim?: boolean } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ? { ...process.env, ...options.env } : undefined,
    });
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk);
    });
    child.on('close', (code) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      resolve({
        stdout: options.trim === false ? stdout : stdout.trim(),
        stderr: stderr.trim(),
        code,
      });
    });
    child.on('error', reject);
  });
}

export async function gitStdout(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; trim?: boolean } = {},
): Promise<string> {
  const result = await runGit(args, options);
  if (result.code === 0) return result.stdout;
  const detail = result.stderr ? `: ${result.stderr}` : '';
  throw new Error(
    `git ${args.join(' ')} failed with code ${result.code}${detail}`,
  );
}

export function runGitWithInput(
  args: string[],
  input: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env ? { ...process.env, ...options.env } : undefined,
    });
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk);
    });
    child.on('close', (code) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      child.stdin.off('error', handleStdinError);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on('error', reject);
    const handleStdinError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') return;
      reject(error);
    };
    child.stdin.on('error', handleStdinError);
    child.stdin.write(input);
    child.stdin.end();
  });
}

export async function gitStdoutWithInput(
  args: string[],
  input: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const result = await runGitWithInput(args, input, options);
  if (result.code === 0) return result.stdout;
  const detail = result.stderr ? `: ${result.stderr}` : '';
  throw new Error(
    `git ${args.join(' ')} failed with code ${result.code}${detail}`,
  );
}

/**
 * Compute effective base branch from options, env vars, and config.
 *
 * Precedence:
 *  1. Explicit CLI option (`--base-branch`)
 *  2. GITHUB_BASE_REF env var (only when running in CI)
 *  3. Project-level `base_branch` from config.yml
 */
export function resolveBaseBranch(
  options: { baseBranch?: string },
  config: Awaited<ReturnType<typeof loadConfig>>,
): string {
  return (
    options.baseBranch ||
    (process.env.GITHUB_BASE_REF &&
    (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true')
      ? process.env.GITHUB_BASE_REF
      : null) ||
    config.project.base_branch
  );
}
