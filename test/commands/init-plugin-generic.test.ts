import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CLIAdapter } from '../../src/cli-adapters/shared.js';
import { installAdapterPlugin } from '../../src/commands/init-plugin.js';

/** Create a minimal mock adapter with optional plugin methods. */
function createMockAdapter(
  overrides: Partial<CLIAdapter> & { name: string },
): CLIAdapter {
  return {
    isAvailable: async () => true,
    checkHealth: async () => ({ available: true, status: 'healthy' as const }),
    execute: async () => '',
    getProjectCommandDir: () => null,
    getUserCommandDir: () => null,
    getProjectSkillDir: () => null,
    getUserSkillDir: () => null,
    getCommandExtension: () => '.md',
    canUseSymlink: () => false,
    transformCommand: (c: string) => c,
    supportsHooks: () => false,
    ...overrides,
  };
}

describe('installAdapterPlugin', () => {
  let warnSpy: ReturnType<typeof mock>;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    originalWarn = console.warn;
    warnSpy = mock(() => {});
    console.warn = warnSpy as unknown as typeof console.warn;
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it('calls adapter.installPlugin() with the correct scope', async () => {
    const installPluginMock = mock(async (_scope: 'user' | 'project') => ({
      success: true,
    }));
    const adapter = createMockAdapter({
      name: 'test-cli',
      installPlugin: installPluginMock,
    });

    await installAdapterPlugin(adapter, '/some/project', 'project');

    expect(installPluginMock).toHaveBeenCalledTimes(1);
    expect(installPluginMock).toHaveBeenCalledWith('project', '/some/project');
  });

  it('calls with user scope when requested', async () => {
    const installPluginMock = mock(async (_scope: 'user' | 'project') => ({
      success: true,
    }));
    const adapter = createMockAdapter({
      name: 'test-cli',
      installPlugin: installPluginMock,
    });

    await installAdapterPlugin(adapter, '/some/project', 'user');

    expect(installPluginMock).toHaveBeenCalledWith('user', '/some/project');
  });

  it('does not print warnings on success', async () => {
    const adapter = createMockAdapter({
      name: 'test-cli',
      installPlugin: async () => ({ success: true }),
    });

    await installAdapterPlugin(adapter, '/some/project', 'project');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('prints warning and manual instructions on failure', async () => {
    const adapter = createMockAdapter({
      name: 'test-cli',
      installPlugin: async () => ({
        success: false,
        error: 'Connection refused',
      }),
      getManualInstallInstructions: (_scope: 'user' | 'project') => [
        'step one',
        'step two',
      ],
    });

    await installAdapterPlugin(adapter, '/some/project', 'project');

    const calls = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Should mention adapter name and failure
    expect(calls.some((c: string) => c.includes('test-cli') && c.includes('failed'))).toBe(
      true,
    );
    // Should print error message
    expect(calls.some((c: string) => c.includes('Connection refused'))).toBe(true);
    // Should print manual instructions header
    expect(calls.some((c: string) => c.includes('Run these steps manually'))).toBe(
      true,
    );
    // Should print each step
    expect(calls.some((c: string) => c.includes('step one'))).toBe(true);
    expect(calls.some((c: string) => c.includes('step two'))).toBe(true);
  });

  it('handles failure with no error message gracefully', async () => {
    const adapter = createMockAdapter({
      name: 'test-cli',
      installPlugin: async () => ({ success: false }),
      getManualInstallInstructions: (_scope: 'user' | 'project') => [
        'do this manually',
      ],
    });

    await installAdapterPlugin(adapter, '/some/project', 'user');

    const calls = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Should still warn about failure
    expect(calls.some((c: string) => c.includes('test-cli') && c.includes('failed'))).toBe(
      true,
    );
    // Should still print manual instructions
    expect(calls.some((c: string) => c.includes('do this manually'))).toBe(true);
  });

  it('handles failure with no getManualInstallInstructions method gracefully', async () => {
    const adapter = createMockAdapter({
      name: 'no-instructions-cli',
      installPlugin: async () => ({
        success: false,
        error: 'Something went wrong',
      }),
      // No getManualInstallInstructions method
    });

    await installAdapterPlugin(adapter, '/some/project', 'project');

    const calls = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Should warn about failure
    expect(
      calls.some((c: string) => c.includes('no-instructions-cli') && c.includes('failed')),
    ).toBe(true);
    // Should print error
    expect(calls.some((c: string) => c.includes('Something went wrong'))).toBe(true);
    // Should NOT print manual instructions header (no method available)
    expect(calls.some((c: string) => c.includes('Run these steps manually'))).toBe(
      false,
    );
  });
});
