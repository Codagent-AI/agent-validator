# Test Guidelines for CI Reliability

This document provides guidelines for writing tests that work reliably in both local development and CI environments.

## Common CI Failures and Solutions

### 1. Module Mocking Issues

**Problem**: Bun runs ALL test files in a single process. `mock.module()` replaces modules in the **global** module registry. A top-level `mock.module()` in one file can silently break tests in other files that import the same module. Tests pass locally (where file order may differ) but fail in CI.

**Rule: Never use `mock.module()` for modules that other test files also import. Use dependency injection instead.**

**Solutions (in order of preference)**:

1. **Prefer dependency injection over module mocking**:
   ```typescript
   // ❌ DANGEROUS: Global module mock — breaks other test files
   mock.module("../../src/gates/review.js", () => ({
     ReviewGateExecutor: class { execute = mockFn; },
   }));
   const runner = new Runner(config, logger, reporter);

   // ✅ SAFE: Inject mock via constructor parameter
   const runner = new Runner(
     config, logger, reporter,
     undefined, undefined, undefined, undefined, undefined, undefined,
     mockCheckExecutor,  // injected
     mockReviewExecutor, // injected
   );
   ```

2. **Patch instance methods instead of module mocking**:
   ```typescript
   // ✅ Reliable: Patch the private method directly
   const executor = new ReviewGateExecutor();
   (executor as any).getDiff = async () => "mock diff content";
   ```

3. **If `mock.module()` is unavoidable, use a single top-level mock with mutable delegates**:
   ```typescript
   // Top level — register ONCE, delegate to mutable vars
   let currentExecute = async () => JSON.stringify({ status: "pass" });
   
   mock.module("../../src/cli-adapters/index.js", () => ({
     getAdapter: (name: string) => ({
       name,
       execute: async (...args: unknown[]) => currentExecute(...args),
       // ...other methods
     }),
     // ...other exports
   }));
   
   const { ReviewGateExecutor } = await import("../../src/gates/review.js");
   
   // Per-test customization via the delegate
   beforeEach(() => {
     currentExecute = async () => JSON.stringify({ status: "pass" });
   });
   
   it("handles usage limit", async () => {
     currentExecute = async () => "You've hit your usage limit.";
     // ...test
   });
   ```

   **Why**: Calling `mock.module()` multiple times (e.g. in `beforeEach`) does NOT invalidate already-loaded modules that import the target. The first `await import()` caches the module; subsequent `mock.module()` calls replace the factory but the cached module keeps its old bindings. A single top-level mock with mutable delegates avoids this.

4. **When using `mock.module()`, always use full paths from the test file location**:
   ```typescript
   // ❌ Wrong: Relative to source file
   mock.module("../cli-adapters/index.js", () => ({...}));
   
   // ✅ Correct: Relative to test file in test/ directory
   mock.module("../../src/cli-adapters/index.js", () => ({...}));
   ```

### Known cross-file mock conflicts

| Module path | Mocked by | Pattern |
|---|---|---|
| `cli-adapters/index.js` | `init.test.ts`, `init-copilot.test.ts`, `review.test.ts` | init files use top-level mock (needed before static import of init.js); review.test.ts uses top-level mock with mutable delegates |
| `gates/review.js` | ~~`runner.test.ts`~~ | **Removed** — replaced with DI via Runner constructor |
| `gates/check.js` | ~~`runner.test.ts`~~ | **Removed** — replaced with DI via Runner constructor |

Before adding a new `mock.module()`, check this table. If the module is already mocked by another file, use DI or the delegate pattern instead.

### 2. Shell Command and Git Operations

**Problem**: Tests that rely on shell commands (especially git) fail in CI due to shallow clones, detached HEAD state, missing history, or different configurations.

**Preferred Solution: Mock shell commands using `spyOn`**

Mocking is preferred because:
- Tests are fast (no process spawning)
- Tests are deterministic (same output every time)
- No environment dependencies
- Easy to test error conditions

```typescript
import { spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";

// Helper to create a mock spawn process
function createMockSpawn(stdout: string, exitCode: number) {
  const mockProcess = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  mockProcess.stdout = new EventEmitter();
  mockProcess.stderr = new EventEmitter();

  setImmediate(() => {
    if (stdout) {
      mockProcess.stdout.emit("data", Buffer.from(stdout));
    }
    mockProcess.emit("close", exitCode);
  });

  return mockProcess;
}

// In your test:
let spawnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  spawnSpy = spyOn(childProcess, "spawn").mockImplementation((cmd, args) => {
    const argsArray = args as string[];
    if (argsArray.includes("--abbrev-ref")) {
      return createMockSpawn("main\n", 0) as ReturnType<typeof childProcess.spawn>;
    }
    if (argsArray.includes("rev-parse")) {
      return createMockSpawn("abc123...\n", 0) as ReturnType<typeof childProcess.spawn>;
    }
    // Default
    return createMockSpawn("", 0) as ReturnType<typeof childProcess.spawn>;
  });
});

afterEach(() => {
  mock.restore();
});
```

### 3. Environment Differences

**Problem**: Tests rely on environment variables or paths that differ between local and CI.

**Solutions**:

1. **Use temporary directories with absolute paths**:
   ```typescript
   const logDir = path.join("/tmp", `test-${Math.random().toString(36).slice(2)}`);
   ```

2. **Save and restore environment variables**:
   ```typescript
   let originalEnv: NodeJS.ProcessEnv;
   
   beforeEach(() => {
     originalEnv = { ...process.env };
   });
   
   afterEach(() => {
     process.env = originalEnv;
   });
   ```

### 4. Async Timing Issues

**Problem**: Tests are flaky because they depend on timing that varies between environments.

**Solutions**:

1. **Use proper async/await patterns**:
   ```typescript
   // ❌ Flaky: Race condition
   executor.start();
   expect(executor.isRunning).toBe(true);
   
   // ✅ Reliable: Wait for operation
   await executor.start();
   expect(executor.isRunning).toBe(true);
   ```

2. **Avoid arbitrary timeouts**:
   ```typescript
   // ❌ Flaky: Hardcoded timeout
   await new Promise(r => setTimeout(r, 100));
   
   // ✅ Reliable: Wait for specific condition
   await waitFor(() => executor.isComplete);
   ```

## Test File Organization

- All test files are in `/test` directory, mirroring the `/src` structure
- Import paths use `../../src/` to reach source files
- Each test file should clean up any resources (temp files, directories) in `afterEach`

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test test/gates/review.test.ts

# Run with verbose output
bun test --verbose
```

## Adding New Tests

1. Create test file in appropriate subdirectory under `/test`
2. Use imports relative to the test file location: `../../src/...`
3. Follow the patterns above for mocking
4. Ensure tests clean up after themselves
5. Run tests locally AND verify they pass in CI before merging

## Anti-patterns to avoid
- ❌ Don't skip tests in CI - tests should run everywhere

